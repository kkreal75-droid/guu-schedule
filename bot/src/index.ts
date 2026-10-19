// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — обновления Telegram (ключ вебхука в заголовке, чужие — 403):
//                   личные сообщения и команды — commands.ts, кнопки рассылки — broadcast.ts.
//   POST /seen    — мини-приложение при открытии присылает initData (+ выбранную группу);
//                   проверяем подпись, отмечаем визит, отвечаем {banned, admin}.
//   GET  /        — настраивает вебхук и меню команд, показывает getWebhookInfo; ?force — заново.
//   cron (раз в минуту) — досылает рассылки пачками.
//
// Секреты (npx wrangler secret put …): BOT_TOKEN, OWNER_ID. Данные — D1 (DB), настройки — KV.

import { isOwner, verifyInitData, webhookSecret } from './auth'
import { drainBroadcasts, onBroadcastButton } from './broadcast'
import { handleBannedCallback, handlePrivateMessage } from './commands'
import { touchUser } from './db'
import { reportError, safely } from './errors'
import { setupBot } from './setup'
import { answerCallback, type TgUpdate } from './telegram'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS })

async function handleUpdate(env: Env, ctx: ExecutionContext, update: TgUpdate): Promise<void> {
  if (update.message) {
    const message = update.message
    if (message.chat.type === 'private') await handlePrivateMessage(env, ctx, message)
    return
  }
  if (update.callback_query) {
    const query = update.callback_query
    await safely(env, 'Кнопка', query.message?.chat.id ?? null, async () => {
      if (await handleBannedCallback(env, query)) return
      if (query.data?.startsWith('bc:')) await onBroadcastButton(env, ctx, query)
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(drainBroadcasts(env).catch((err) => reportError(env, 'Досылка рассылок', err)))
  },
} satisfies ExportedHandler<Env>
