// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — обновления Telegram (ключ вебхука в заголовке, чужие — 403):
//                   личные сообщения и команды — commands.ts, беседы — chats.ts,
//                   inline-запросы — inline.ts, кнопки рассылки — broadcast.ts.
//   POST /seen    — мини-приложение при открытии присылает initData (+ выбранную группу);
//                   проверяем подпись, отмечаем визит, отвечаем {banned, admin, me, …}.
//   POST /profile — выбор в онбординге: роль, группа или преподаватель (profile.ts); POST /intro — знакомство просмотрено.
//   POST /cal/status|connect|disconnect — подписка на календарь (calendar.ts);
//   GET  /cal/<токен>.ics — сам календарь для Apple/Google; /cal/<токен>/apple — страница «Подписаться» для iPhone.
//   POST /board/<действие> — «Подслушано», анонимный чат (board.ts), жалобы и баны — board-moderation.ts.
//   POST /reviews/<действие> — рейтинг преподавателей: отзывы, жалобы (reviews.ts).
//   GET  /places  — правки мест «Корпусов ГУУ» поверх data/places.json (places.ts), правит владелец в админке.
//   GET  /academic — правки учебного графика поверх типового (academic.ts), правит владелец в админке.
//   POST /support — «Написать в поддержку»: владельцу в бот, ответ — через кнопку «Ответить» (support.ts).
//   POST /admin/<действие> — админ-панель (admin-api.ts), только OWNER_ID.
//   GET  /        — настраивает вебхук и меню команд, показывает getWebhookInfo; ?force — заново (≤ 3 раз в минуту).
//   GET  /health  — жив ли воркер и D1 (для мониторинга, без внутренних данных).
// Вход защищает guard.ts: лимит тела, CORS только для приложения, лимиты запросов по IP и пользователю.
//   cron (раз в минуту) — сводки в беседы и изменения расписания (digest.ts), досылка рассылок,
//   раз в 10 минут — тревоги автообновления (alerts.ts) и рассылка о новой сессии (session.ts), раз в час — чистка Подслушано.
//
// Секреты (npx wrangler secret put …): BOT_TOKEN, OWNER_ID, BOARD_SALT, GITHUB_TOKEN.
// Данные — D1 (DB), настройки — KV.

import { isOwner, verifyInitData, webhookSecret } from './auth'
import { BODY_LIMIT, WEBHOOK_LIMIT, allow, clientIp, readBody, safeEqual, tooMany, withCors } from './guard'
import { handleAdminApi } from './admin-api'
import { CORS, json } from './api'
import { boardLatest, handleBoardApi, isBoardAction } from './board'
import { sendAlerts } from './alerts'
import { notifySessions } from './session'
import { cleanupBoard, onBoardButton } from './board-moderation'
import { handleReviewsApi, isReviewAction, onReviewButton } from './reviews'
import { handleAcademicGet } from './academic'
import { handlePlacesGet } from './places'
import { handleSupport, onSupportButton } from './support'
import { BATCH, drainBroadcasts, onBroadcastButton } from './broadcast'
import { handleAppleSubscribe, handleCalendarApi, handleIcs } from './calendar'
import { handleGroupMessage, handleMembership, onGroupSetupButton } from './chats'
import { handleBannedCallback, handlePrivateMessage } from './commands'
import { mbName, normalizeGroup } from '../../shared/groups'
import { touchUser } from './db'
import { detectChanges, runDigests } from './digest'
import { extrasFor, loadExtras } from './edits'
import { reportError, safely } from './errors'
import { handleInlineQuery } from './inline'
import { handleIntro, handleProfile } from './profile'
import { handleExtras, handleMySubgroups, handleStarostaApi } from './starosta'
import { loadSettings } from './settings'
import { setupBot } from './setup'
import { answerCallback, type TgUpdate } from './telegram'

// Кто прислал обновление и стоит ли его считать в лимит: личка, кнопки, inline и команды в беседах.
// Обычные сообщения в беседах бот и так пропускает, не читая базу.
function updateSender(update: TgUpdate): number | null {
  const message = update.message
  if (message) {
    const command = (message.text ?? message.caption ?? '').startsWith('/')
    return message.chat.type === 'private' || command ? (message.from?.id ?? null) : null
  }
  return update.callback_query?.from.id ?? update.inline_query?.from.id ?? null
}

async function handleUpdate(env: Env, ctx: ExecutionContext, update: TgUpdate): Promise<void> {
  // флуд одного человека — молча пропускаем, до базы и до Telegram (владельца не ограничиваем)
  const sender = updateSender(update)
  if (sender !== null && !isOwner(env, sender) && !(await allow(env, 'RL_BOT', sender))) return
  if (update.message) {
    const message = update.message
    if (message.chat.type === 'private') await handlePrivateMessage(env, ctx, message)
    // в беседе ответ об ошибке пишет сам handleGroupMessage — в ту же тему, а не в General
    else await safely(env, 'Сообщение в беседе', null, () => handleGroupMessage(env, message))
    return
  }
  if (update.my_chat_member) {
    const change = update.my_chat_member
    await safely(env, 'Добавление в беседу', null, () => handleMembership(env, change))
    return
  }
  if (update.inline_query) {
    const query = update.inline_query
    // ответить «Что-то сломалось» в inline некуда — только сообщаем владельцу
    await safely(env, 'Inline-запрос', null, () => handleInlineQuery(env, query))
    return
  }
  if (update.callback_query) {
    const query = update.callback_query
    // в беседах ошибку кнопки показывает всплывающий текст, в чат не пишем (в форуме — это General)
    const chatId = query.message?.chat.type === 'private' ? query.message.chat.id : null
    await safely(env, 'Кнопка', chatId, async () => {
      if (await handleBannedCallback(env, query)) return
      if (query.data?.startsWith('bc:')) await onBroadcastButton(env, ctx, query)
      else if (query.data?.startsWith('gs:')) await onGroupSetupButton(env, query)
      else if (query.data?.startsWith('bd:')) await onBoardButton(env, query)
      else if (query.data?.startsWith('rv:')) await onReviewButton(env, query)
      else if (query.data?.startsWith('sp:')) await onSupportButton(env, query)
      else await answerCallback(env, query.id)
    })
  }
}

// Ошибка в обработчике API: приложению — 500 (оно покажет «Что-то сломалось 🛠»), владельцу — текст
async function guarded(env: Env, where: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (err) {
    await reportError(env, where, err)
    return json({ ok: false, error: 'internal' }, 500)
  }
}

// Что приложению показать при открытии: ручные правки расписания (за 2 недели назад и вперёд),
// объявление-плашку и режим техработ (админу — никогда). Старые версии приложения (без v) ждут
// в правках имя группы («МБ(МП) 1-1»), новые — id.
// groups — какие группы приложение показывает (своя, избранные; v2): правки и подгруппы только их.
async function appExtras(env: Env, admin: boolean, version: number, groups: string[] | null) {
  const [settings, all] = await Promise.all([loadSettings(env), loadExtras(env)])
  const extras = groups ? extrasFor(all, groups) : all
  const since = new Date(Date.now() + 3 * 3_600_000 - 14 * 86_400_000).toISOString().slice(0, 10)
  const groupOut = (group: string) => (version >= 2 ? group : (mbName(group) ?? group))
  return {
    edits:
      version >= 2
        ? extras.edits.map(({ author: _, ...e }) => e)
        : // старые версии знают только отмену и пометку
          extras.edits
            .filter((e) => e.date >= since && (e.kind === 'cancel' || e.kind === 'note'))
            .map(({ id, group, date, start, kind, text }) => ({ id, group: groupOut(group), date, start, kind, text })),
    subgroups: extras.subgroups,
    tags: extras.tags,
    notice: settings.notice.on && settings.notice.text ? { id: settings.notice.id, text: settings.notice.text } : null,
    maintenance: settings.maintenance.on && !admin ? settings.maintenance.text : null,
    channel: settings.channel || null,
  }
}

// Открытие мини-приложения. Тело — JSON {initData, group, v} или просто initData (старые версии).
// group — id группы (старые версии присылают имя «МБ(МП) 1-1»), v — версия формата приложения.
// В ответе ещё время последнего сообщения в Подслушано (точка «есть новое») и appExtras.
async function handleSeen(env: Env, request: Request): Promise<Response> {
  const body = await readBody(request, BODY_LIMIT)
  if (body instanceof Response) return body
  let initData = body
  let group: string | null = null
  let groups: string[] | null = null
  let version = 1
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { initData?: string; group?: string; groups?: unknown; v?: number }
      initData = parsed.initData ?? ''
      group = parsed.group ?? null
      version = typeof parsed.v === 'number' ? parsed.v : 1
      if (Array.isArray(parsed.groups)) {
        groups = parsed.groups.map(normalizeGroup).filter((g): g is string => Boolean(g)).slice(0, 10)
      }
    } catch {
      return json({ ok: false }, 400)
    }
  }
  const profile = await verifyInitData(initData, env)
  if (!profile) return json({ ok: false }, 403)
  if (!(await allow(env, 'RL_SEEN', profile.id))) return tooMany()
  try {
    const admin = isOwner(env, profile.id)
    const [{ banned, me }, board, extras] = await Promise.all([
      touchUser(env.DB, profile, 'open', group),
      // «Подслушано», правки и настройки не должны мешать открытию приложения
      boardLatest(env).catch((err) => (console.error('Подслушано в /seen:', err), {})),
      appExtras(env, admin, version, groups).catch((err) => (console.error('Правки и настройки в /seen:', err), {})),
    ])
    return json({ ok: true, banned: banned && !admin, admin, me, board, ...extras })
  } catch (err) {
    await reportError(env, 'Открытие приложения', err)
    return json({ ok: false }, 500)
  }
}

// GET /health — для мониторинга: жив ли воркер и отвечает ли D1 (проверка — не чаще раза в 30 с)
let health: { at: number; ok: boolean } | null = null
async function handleHealth(env: Env): Promise<Response> {
  if (!health || Date.now() - health.at > 30_000) {
    let ok = true
    try {
      await env.DB.prepare('SELECT 1').first()
    } catch {
      ok = false
    }
    health = { at: Date.now(), ok }
  }
  return Response.json({ ok: health.ok }, { status: health.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

// Обновление от Telegram: только POST, секрет в заголовке (сравнение в постоянное время), тело до 1 МБ.
// Отвечаем сразу, обработка — в фоне, иначе Telegram повторит запрос.
async function handleWebhook(env: Env, ctx: ExecutionContext, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('not found', { status: 404 })
  if (!safeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', await webhookSecret(env))) {
    return new Response('forbidden', { status: 403 })
  }
  const text = await readBody(request, WEBHOOK_LIMIT)
  if (text instanceof Response) return text
  let update: TgUpdate | null = null
  try {
    update = JSON.parse(text) as TgUpdate
  } catch {
    return new Response('ok')
  }
  if (update && typeof update === 'object') {
    ctx.waitUntil(handleUpdate(env, ctx, update).catch((err) => reportError(env, 'Обновление Telegram', err)))
  }
  return new Response('ok')
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.BOT_TOKEN) return new Response('not configured', { status: 500 })
    const url = new URL(request.url)
    // вебхук — с IP Telegram, свой секрет; его не ограничиваем по IP
    if (url.pathname === '/webhook') return handleWebhook(env, ctx, request)
    // флуд с одного адреса — 429 сразу, без D1/KV (лимит щедрый: в общежитии и Wi-Fi ГУУ адрес общий)
    if (!(await allow(env, 'RL_IP', clientIp(request)))) return withCors(env, request, tooMany())
    return withCors(env, request, await route(env, ctx, request, url))
  },

  // Раз в минуту. Лимит — 50 подзапросов на вызов: сначала то, что привязано ко времени
  // (сводки, изменения), рассылкам — что осталось; недосланное подхватит следующая минута.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await runCron(controller, env, ctx)
  },
} satisfies ExportedHandler<Env>

async function route(env: Env, ctx: ExecutionContext, request: Request, url: URL): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // публичное (без initData) — свой лимит по IP: из кэша, но запрос всё равно стоит денег
  const publicGet = request.method === 'GET' && ['/', '/health', '/places', '/academic'].includes(url.pathname)
  if (publicGet && !(await allow(env, 'RL_PUBLIC', clientIp(request)))) return tooMany()
  if (url.pathname === '/health' && request.method === 'GET') return handleHealth(env)

  if (url.pathname === '/seen' && request.method === 'POST') return handleSeen(env, request)
  if (url.pathname === '/profile' && request.method === 'POST') return guarded(env, 'Профиль', () => handleProfile(env, request))
  if (url.pathname === '/support' && request.method === 'POST') return guarded(env, 'Поддержка', () => handleSupport(env, request))
  if (url.pathname === '/places' && request.method === 'GET') return guarded(env, 'Места', () => handlePlacesGet(env, request))
  if (url.pathname === '/academic' && request.method === 'GET') return guarded(env, 'Учебный график', () => handleAcademicGet(env, request))
  if (url.pathname === '/intro' && request.method === 'POST') return guarded(env, 'Знакомство', () => handleIntro(env, request))
  if (url.pathname === '/my-subgroups' && request.method === 'POST') return guarded(env, 'Подгруппы', () => handleMySubgroups(env, request))
  if (url.pathname === '/extras' && request.method === 'POST') return guarded(env, 'Правки групп', () => handleExtras(env, request))
  const starosta = url.pathname.match(/^\/starosta\/([a-z-]+)$/)
  if (starosta && request.method === 'POST') {
    const action = starosta[1]
    return guarded(env, `Староста: ${action}`, () => handleStarostaApi(env, request, action))
  }

  // календарь: подписка из приложения и сам .ics для Apple/Google
  const cal = url.pathname.match(/^\/cal\/(status|connect|disconnect)$/)
  if (cal && request.method === 'POST') return guarded(env, 'Календарь', () => handleCalendarApi(env, request, cal[1]))
  const apple = url.pathname.match(/^\/cal\/([\w-]{20,64})\/apple$/)
  if (apple && request.method === 'GET') return guarded(env, 'Календарь Apple', () => handleAppleSubscribe(env, request, apple[1]))
  const ics = url.pathname.match(/^\/cal\/([\w-]{20,64})\.ics$/)
  if (ics && (request.method === 'GET' || request.method === 'HEAD')) {
    // календари (Google, Apple) ходят с общих адресов — лимит по ссылке, а не по IP
    if (!(await allow(env, 'RL_PUBLIC', `ics:${ics[1]}`))) return tooMany()
    return guarded(env, 'Календарь .ics', () => handleIcs(env, ctx, ics[1]))
  }

  const admin = url.pathname.match(/^\/admin\/([a-z-]+)$/)
  if (admin && request.method === 'POST') {
    const action = admin[1]
    return guarded(env, `Админ-панель: ${action}`, () => handleAdminApi(env, ctx, request, action))
  }

  const board = url.pathname.match(/^\/board\/([a-z]+)$/)
  if (board && request.method === 'POST' && isBoardAction(board[1])) {
    const action = board[1]
    return guarded(env, `Подслушано: ${action}`, () => handleBoardApi(env, request, action))
  }

  const reviews = url.pathname.match(/^\/reviews\/([a-z]+)$/)
  if (reviews && request.method === 'POST' && isReviewAction(reviews[1])) {
    const action = reviews[1]
    return guarded(env, `Отзывы: ${action}`, () => handleReviewsApi(env, request, action))
  }

  if (url.pathname === '/' && request.method === 'GET') {
    // настройка вебхука ходит в Telegram 4–8 раз — не чаще 3 раз в минуту на всех
    if (!(await allow(env, 'RL_SETUP', 'setup'))) return tooMany()
    try {
      return Response.json(await setupBot(env, url.origin, url.searchParams.has('force')))
    } catch (err) {
      await reportError(env, 'Настройка вебхука', err)
      return Response.json({ ok: false, error: 'telegram' }, { status: 502 })
    }
  }

  return new Response('not found', { status: 404 })
}

async function runCron(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const now = controller.scheduledTime
  const run = async () => {
    let used = 0
    used += await runDigests(env, now).catch((err) => (reportError(env, 'Сводки в беседы', err), 0))
    if (new Date(now).getUTCMinutes() % 10 === 5) {
      used += await detectChanges(env, now).catch((err) => (reportError(env, 'Изменения расписания', err), 0))
      used += await sendAlerts(env).catch((err) => (reportError(env, 'Тревоги автообновления', err), 0))
    }
    if (new Date(now).getUTCMinutes() % 10 === 7) {
      used += await notifySessions(env).catch((err) => (reportError(env, 'Рассылка о сессии', err), 0))
    }
    if (new Date(now).getUTCMinutes() === 35) {
      used += await cleanupBoard(env, now).catch((err) => (reportError(env, 'Чистка Подслушано', err), 0))
    }
    const batch = Math.max(0, BATCH - used)
    if (batch) await drainBroadcasts(env, batch).catch((err) => reportError(env, 'Досылка рассылок', err))
  }
  ctx.waitUntil(run())
}
