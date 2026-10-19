// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — обновления Telegram (ключ вебхука в заголовке, чужие — 403):
//                   личные сообщения и команды — commands.ts, беседы — chats.ts,
//                   inline-запросы — inline.ts, кнопки рассылки — broadcast.ts.
//   POST /seen    — мини-приложение при открытии присылает initData (+ выбранную группу);
//                   проверяем подпись, отмечаем визит, отвечаем {banned, admin}.
//   GET  /        — настраивает вебхук и меню команд, показывает getWebhookInfo; ?force — заново.
//   cron (раз в минуту) — сводки в беседы и изменения расписания (digest.ts), досылка рассылок.
//
// Секреты (npx wrangler secret put …): BOT_TOKEN, OWNER_ID. Данные — D1 (DB), настройки — KV.

import { isOwner, verifyInitData, webhookSecret } from './auth'
import { BATCH, drainBroadcasts, onBroadcastButton } from './broadcast'
import { handleGroupMessage, handleMembership, onGroupSetupButton } from './chats'
import { handleBannedCallback, handlePrivateMessage } from './commands'
import { touchUser } from './db'
import { detectChanges, runDigests } from './digest'
import { reportError, safely } from './errors'
import { handleInlineQuery } from './inline'
import { setupBot } from './setup'
import { answerCallback, type TgUpdate } from './telegram'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS })

async function handleUpdate(env: Env, ctx: ExecutionContext, update: TgUpdate): Promise<void> {
  if (update.message) {
    const message = update.message
    if (message.chat.type === 'private') await handlePrivateMessage(env, ctx, message)
    else await safely(env, 'Сообщение в беседе', message.chat.id, () => handleGroupMessage(env, message))
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
    await safely(env, 'Кнопка', query.message?.chat.id ?? null, async () => {
      if (await handleBannedCallback(env, query)) return
      if (query.data?.startsWith('bc:')) await onBroadcastButton(env, ctx, query)
      else if (query.data?.startsWith('gs:')) await onGroupSetupButton(env, query)
      else await answerCallback(env, query.id)
    })
  }
}

// Открытие мини-приложения. Тело — JSON {initData, group} или просто initData (старые версии).
async function handleSeen(env: Env, request: Request): Promise<Response> {
  const body = await request.text()
  let initData = body
  let group: string | null = null
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { initData?: string; group?: string }
      initData = parsed.initData ?? ''
      group = parsed.group ?? null
    } catch {
      return json({ ok: false }, 400)
    }
  }
  const profile = await verifyInitData(initData, env)
  if (!profile) return json({ ok: false }, 403)
  try {
    const { banned } = await touchUser(env.DB, profile, 'open', group)
    const admin = isOwner(env, profile.id)
    return json({ ok: true, banned: banned && !admin, admin })
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
      }
      const batch = Math.max(0, BATCH - used)
      if (batch) await drainBroadcasts(env, batch).catch((err) => reportError(env, 'Досылка рассылок', err))
    }
    ctx.waitUntil(run())
  },
} satisfies ExportedHandler<Env>
