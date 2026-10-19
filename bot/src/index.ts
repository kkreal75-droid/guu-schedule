// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — сюда Telegram присылает сообщения. Команды:
//                   /start — приветствие и кнопка, которая открывает мини-приложение (WEBAPP_URL);
//                   /stats — статистика из KV, только для владельца (OWNER_ID).
//                   Если команда падает, бот отвечает «Что-то сломалось 🛠», а ошибка уходит в лог
//                   (npx wrangler tail).
//   GET  /        — регистрирует вебхук на этот воркер и показывает getWebhookInfo
//                   (адрес, очередь, last_error_message); ?force — перерегистрировать.
//
// Секреты (npx wrangler secret put …): BOT_TOKEN, OWNER_ID — Telegram ID владельца.
// Ключ вебхука получается из BOT_TOKEN: Telegram кладёт его в заголовок каждого запроса,
// чужие запросы отбрасываем.

// Минимум из API Workers KV, который нам нужен
interface KV {
  getWithMetadata<M>(key: string): Promise<{ value: string | null; metadata: M | null }>
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>
  list<M>(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string; metadata?: M }[]
    list_complete: boolean
    cursor?: string
  }>
}

export interface Env {
  BOT_TOKEN: string
  OWNER_ID?: string
  WEBAPP_URL: string
  STATS?: KV // KV namespace (wrangler.jsonc → kv_namespaces)
  TELEGRAM_API?: string // только для локальной проверки с поддельным Telegram
}

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void }

type Message = {
  text?: string
  chat: { id: number; type: string }
  from?: { id: number; first_name?: string }
}

type Update = { message?: Message }

type WebhookInfo = {
  url?: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
}

// Статистика: по ключу на пользователя (user:<id>), данные — в metadata,
// чтобы /stats собирал всё одним list() без чтения каждого ключа. Имён не храним.
type UserStats = { first: number; last: number; starts: number }

const ERROR_REPLY = 'Что-то сломалось 🛠'
const DAY_MS = 86_400_000

const GREETINGS: ((name: string) => string)[] = [
  (name) => `<b>${name}, здарова, брат!</b> 🤝

Как ты, мой дорогой? Надеюсь, выспался 😴

Держи <b>бесплатное расписание</b> МБ(МП) 1-1 и 1-2 — без подписок, без регистрации, без смс 🎁

📅 какая пара, где и у кого
🔁 чётная или нечётная неделя — уже посчитано
📝 заметки, чтобы не забыть домашку

Пользуйся на здоровье, брат 👇`,

  (name) => `<b>${name}, брат, здарова!</b> 👊
Как жизнь, родной? Всё ровно?
Вот тебе расписание — бесплатно, от души ❤️ 👇`,

  (name) => `<b>Ооо, ${name}! Здарова, брат!</b> 🫂
Как сам, дорогой? Давно не виделись.
Держи расписание — бесплатно, как для своих 👇`,
]

// first_name может быть каким угодно, вплоть до «<b>»: без экранирования Telegram отклонит HTML
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function webhookSecret(env: Env): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`webhook:${env.BOT_TOKEN}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Ошибку Telegram (ok: false) превращаем в исключение — иначе её проглотят молча
async function telegram<T = unknown>(env: Env, method: string, body: unknown): Promise<T> {
  const base = env.TELEGRAM_API || 'https://api.telegram.org'
  const res = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: T } | null
  if (!data?.ok) throw new Error(`Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`)
  return data.result as T
}

const reply = (env: Env, message: Message, text: string, extra: object = {}) =>
  telegram(env, 'sendMessage', { chat_id: message.chat.id, text, parse_mode: 'HTML', ...extra })

// ---------- статистика ----------

async function recordStart(message: Message, env: Env): Promise<void> {
  if (!env.STATS || !message.from) return
  const key = `user:${message.from.id}`
  const now = Date.now()
  const { metadata } = await env.STATS.getWithMetadata<UserStats>(key)
  const stats: UserStats = metadata
    ? { ...metadata, last: now, starts: metadata.starts + 1 }
    : { first: now, last: now, starts: 1 }
  await env.STATS.put(key, '', { metadata: stats })
}

async function allUsers(kv: KV): Promise<UserStats[]> {
  const users: UserStats[] = []
  let cursor: string | undefined
  do {
    const page = await kv.list<UserStats>({ prefix: 'user:', cursor })
    for (const key of page.keys) if (key.metadata) users.push(key.metadata)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return users
}

// ---------- команды ----------

async function handleStart(message: Message, env: Env): Promise<void> {
  // статистика не должна мешать приветствию: не записалась — только пишем в лог
  await recordStart(message, env).catch((err) => console.error('Статистика /start не записалась:', err))

  const name = escapeHtml(message.from?.first_name?.trim() || 'брат')
  const greet = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
  // кнопки web_app Telegram разрешает только в личных чатах; в группе — обычная ссылка
  const button =
    message.chat.type === 'private'
      ? { text: '📅 Открыть расписание', web_app: { url: env.WEBAPP_URL } }
      : { text: '📅 Открыть расписание', url: env.WEBAPP_URL }
  await reply(env, message, greet(name), { reply_markup: { inline_keyboard: [[button]] } })
}

async function handleStats(message: Message, env: Env): Promise<void> {
  if (!env.OWNER_ID || String(message.from?.id) !== env.OWNER_ID.trim()) {
    await reply(env, message, 'Эта команда только для владельца бота 🙂')
    return
  }
  if (!env.STATS) throw new Error('KV namespace STATS не подключён (wrangler.jsonc → kv_namespaces)')

  const users = await allUsers(env.STATS)
  const now = Date.now()
  const count = (pred: (u: UserStats) => boolean) => users.filter(pred).length
  const starts = users.reduce((sum, u) => sum + u.starts, 0)
  await reply(
    env,
    message,
    `📊 <b>Статистика бота</b>

👥 Пользователей: <b>${users.length}</b>
🆕 Новых за 7 дней: <b>${count((u) => u.first >= now - 7 * DAY_MS)}</b>
🔥 Заходили за сутки: <b>${count((u) => u.last >= now - DAY_MS)}</b>
▶️ Всего /start: <b>${starts}</b>`,
  )
}

const COMMANDS: Record<string, (message: Message, env: Env) => Promise<void>> = {
  '/start': handleStart,
  '/stats': handleStats,
}

async function handleUpdate(update: Update, env: Env): Promise<void> {
  const message = update.message
  // «/start», «/stats@имя_бота», «/start что-то»
  const command = message?.text?.trim().split(/\s+/)[0].split('@')[0].toLowerCase()
  const handler = command ? COMMANDS[command] : undefined
  if (!message || !handler) return

  try {
    await handler(message, env)
  } catch (err) {
    console.error(`Команда ${command} упала:`, err instanceof Error ? (err.stack ?? err.message) : err)
    await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: ERROR_REPLY }).catch((sendErr) =>
      console.error('Не удалось отправить сообщение об ошибке:', sendErr),
    )
  }
}

// ---------- вебхук ----------

async function ensureWebhook(env: Env, origin: string, force: boolean) {
  const url = `${origin}/webhook`
  let info = await telegram<WebhookInfo>(env, 'getWebhookInfo', {})
  let changed = false
  if (force || info.url !== url) {
    await telegram(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ['message'] })
    info = await telegram<WebhookInfo>(env, 'getWebhookInfo', {})
    changed = true
  }
  return {
    ok: true,
    changed,
    webhook: info.url,
    pending_update_count: info.pending_update_count ?? 0,
    last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    last_error_message: info.last_error_message ?? null,
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.BOT_TOKEN) {
      return new Response('BOT_TOKEN не задан: npx wrangler secret put BOT_TOKEN', { status: 500 })
    }
    const url = new URL(request.url)

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) {
        return new Response('forbidden', { status: 403 })
      }
      const update = (await request.json().catch(() => null)) as Update | null
      // Telegram отвечаем сразу, а сообщение отправляем в фоне — иначе он повторит запрос
      if (update) ctx.waitUntil(handleUpdate(update, env))
      return new Response('ok')
    }

    if (url.pathname === '/' && request.method === 'GET') {
      try {
        return Response.json(await ensureWebhook(env, url.origin, url.searchParams.has('force')))
      } catch (err) {
        console.error('Вебхук:', err)
        return Response.json({ ok: false, error: String(err) }, { status: 502 })
      }
    }

    return new Response('not found', { status: 404 })
  },
}
