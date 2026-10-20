// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — обновления Telegram (ключ вебхука в заголовке, чужие — 403):
//                   личные сообщения и команды — commands.ts, беседы — chats.ts,
//                   inline-запросы — inline.ts, кнопки рассылки — broadcast.ts.
//   POST /seen    — мини-приложение при открытии присылает initData (+ выбранную группу);
//                   проверяем подпись, отмечаем визит, отвечаем {banned, admin}.
//   POST /cal/status|connect|disconnect — подписка на календарь (calendar.ts);
//   GET  /cal/<токен>.ics — сам календарь для Apple/Google; /cal/<токен>/apple — страница «Подписаться» для iPhone.
//   POST /board/<действие> — анонимная доска (board.ts), жалобы и баны — board-moderation.ts.
//   POST /admin/<действие> — админ-панель (admin-api.ts), только OWNER_ID.
//   GET  /        — настраивает вебхук и меню команд, показывает getWebhookInfo; ?force — заново.
//   cron (раз в минуту) — сводки в беседы и изменения расписания (digest.ts), досылка рассылок,
//   раз в 10 минут — тревоги автообновления (alerts.ts), раз в час — чистка доски.
//
// Секреты (npx wrangler secret put …): BOT_TOKEN, OWNER_ID, BOARD_SALT, GITHUB_TOKEN.
// Данные — D1 (DB), настройки — KV.

import { isOwner, verifyInitData, webhookSecret } from './auth'
import { handleAdminApi } from './admin-api'
import { CORS, json } from './api'
import { boardLatest, handleBoardApi, isBoardAction } from './board'
import { sendAlerts } from './alerts'
import { cleanupBoard, onBoardButton } from './board-moderation'
import { BATCH, drainBroadcasts, onBroadcastButton } from './broadcast'
import { handleAppleSubscribe, handleCalendarApi, handleIcs } from './calendar'
import { handleGroupMessage, handleMembership, onGroupSetupButton } from './chats'
import { handleBannedCallback, handlePrivateMessage } from './commands'
import { mbName } from '../../shared/groups'
import { touchUser } from './db'
import { detectChanges, runDigests } from './digest'
import { loadEdits } from './edits'
import { reportError, safely } from './errors'
import { handleInlineQuery } from './inline'
import { loadSettings } from './settings'
import { setupBot } from './setup'
import { answerCallback, type TgUpdate } from './telegram'

async function handleUpdate(env: Env, ctx: ExecutionContext, update: TgUpdate): Promise<void> {
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
async function appExtras(env: Env, admin: boolean, version: number) {
  const [settings, edits] = await Promise.all([loadSettings(env), loadEdits(env)])
  const since = new Date(Date.now() + 3 * 3_600_000 - 14 * 86_400_000).toISOString().slice(0, 10)
  const groupOut = (group: string) => (version >= 2 ? group : (mbName(group) ?? group))
  return {
    edits: edits
      .filter((e) => e.date >= since)
      .map(({ id, group, date, start, kind, text }) => ({ id, group: groupOut(group), date, start, kind, text })),
    notice: settings.notice.on && settings.notice.text ? { id: settings.notice.id, text: settings.notice.text } : null,
    maintenance: settings.maintenance.on && !admin ? settings.maintenance.text : null,
  }
}

// Открытие мини-приложения. Тело — JSON {initData, group, v} или просто initData (старые версии).
// group — id группы (старые версии присылают имя «МБ(МП) 1-1»), v — версия формата приложения.
// В ответе ещё время последних сообщений на досках (точка «есть новое») и appExtras.
async function handleSeen(env: Env, request: Request): Promise<Response> {
  const body = await request.text()
  let initData = body
  let group: string | null = null
  let version = 1
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { initData?: string; group?: string; v?: number }
      initData = parsed.initData ?? ''
      group = parsed.group ?? null
      version = typeof parsed.v === 'number' ? parsed.v : 1
    } catch {
      return json({ ok: false }, 400)
    }
  }
  const profile = await verifyInitData(initData, env)
  if (!profile) return json({ ok: false }, 403)
  try {
    const admin = isOwner(env, profile.id)
    const [{ banned }, board, extras] = await Promise.all([
      touchUser(env.DB, profile, 'open', group),
      // доска, правки и настройки не должны мешать открытию приложения
      boardLatest(env).catch((err) => (console.error('Доска в /seen:', err), {})),
      appExtras(env, admin, version).catch((err) => (console.error('Правки и настройки в /seen:', err), {})),
    ])
    return json({ ok: true, banned: banned && !admin, admin, board, ...extras })
  } catch (err) {
    await reportError(env, 'Открытие приложения', err)
    return json({ ok: false }, 500)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.BOT_TOKEN) {
      return new Response('BOT_TOKEN не задан: npx wrangler secret put BOT_TOKEN', { status: 500 })
    }
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) {
        return new Response('forbidden', { status: 403 })
      }
      const update = (await request.json().catch(() => null)) as TgUpdate | null
      // Telegram отвечаем сразу, обработка — в фоне, иначе он повторит запрос
      if (update) {
        ctx.waitUntil(handleUpdate(env, ctx, update).catch((err) => reportError(env, 'Обновление Telegram', err)))
      }
      return new Response('ok')
    }

    if (url.pathname === '/seen' && request.method === 'POST') return handleSeen(env, request)

    // календарь: подписка из приложения и сам .ics для Apple/Google
    const cal = url.pathname.match(/^\/cal\/(status|connect|disconnect)$/)
    if (cal && request.method === 'POST') return guarded(env, 'Календарь', () => handleCalendarApi(env, request, cal[1]))
    const apple = url.pathname.match(/^\/cal\/([\w-]{20,})\/apple$/)
    if (apple && request.method === 'GET') return guarded(env, 'Календарь Apple', () => handleAppleSubscribe(env, request, apple[1]))
    const ics = url.pathname.match(/^\/cal\/([\w-]{20,})\.ics$/)
    if (ics && (request.method === 'GET' || request.method === 'HEAD')) {
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
      return guarded(env, `Доска: ${action}`, () => handleBoardApi(env, ctx, request, action))
    }

    if (url.pathname === '/' && request.method === 'GET') {
      try {
        return Response.json(await setupBot(env, url.origin, url.searchParams.has('force')))
      } catch (err) {
        await reportError(env, 'Настройка вебхука', err)
        return Response.json({ ok: false, error: String(err) }, { status: 502 })
      }
    }

    return new Response('not found', { status: 404 })
  },

  // Раз в минуту. Лимит — 50 подзапросов на вызов: сначала то, что привязано ко времени
  // (сводки, изменения), рассылкам — что осталось; недосланное подхватит следующая минута.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = controller.scheduledTime
    const run = async () => {
      let used = 0
      used += await runDigests(env, now).catch((err) => (reportError(env, 'Сводки в беседы', err), 0))
      if (new Date(now).getUTCMinutes() % 10 === 5) {
        used += await detectChanges(env, now).catch((err) => (reportError(env, 'Изменения расписания', err), 0))
        used += await sendAlerts(env).catch((err) => (reportError(env, 'Тревоги автообновления', err), 0))
      }
      if (new Date(now).getUTCMinutes() === 35) {
        used += await cleanupBoard(env, now).catch((err) => (reportError(env, 'Чистка доски', err), 0))
      }
      const batch = Math.max(0, BATCH - used)
      if (batch) await drainBroadcasts(env, batch).catch((err) => reportError(env, 'Досылка рассылок', err))
    }
    ctx.waitUntil(run())
  },
} satisfies ExportedHandler<Env>
