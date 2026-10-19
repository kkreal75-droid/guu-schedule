// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — сюда Telegram присылает сообщения. Команды:
//                   /start — приветствие и кнопка, которая открывает мини-приложение (WEBAPP_URL);
//                   /stats — статистика из KV, только для владельца (OWNER_ID).
//                   Если команда падает, бот отвечает «Что-то сломалось 🛠», а ошибка уходит в лог
//                   (npx wrangler tail).
//   POST /seen    — мини-приложение при открытии присылает сюда initData от Telegram;
//                   проверяем подпись токеном бота и отмечаем человека в статистике.
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
  from?: TelegramUser
}

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string }

// кто это: ник и имя из Telegram — для списка в /stats
type Profile = { id: number; username?: string; name?: string }

const profileOf = (user: TelegramUser): Profile => ({
  id: user.id,
  username: user.username || undefined,
  name: [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 64) || undefined,
})

type Update = { message?: Message }

type WebhookInfo = {
  url?: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
}

// Статистика: по ключу на пользователя (user:<id>), данные — в metadata,
// чтобы /stats собирал всё одним list() без чтения каждого ключа.
type UserStats = {
  first: number // впервые замечен (любым способом)
  last: number // последний раз замечен
  starts: number // сколько раз нажимал /start
  opens?: number // сколько раз открывал мини-приложение (не чаще раза в OPEN_THROTTLE_MS)
  lastOpen?: number
  username?: string // ник Telegram, если есть
  name?: string // имя и фамилия из профиля Telegram
}

const ERROR_REPLY = 'Что-то сломалось 🛠'
const DAY_MS = 86_400_000
// повторные открытия одного человека чаще этого в KV не пишем: на бесплатном тарифе
// KV — 1000 записей в сутки
const OPEN_THROTTLE_MS = 10 * 60_000
// initData старше суток не принимаем — меньше простора для повторной отправки чужих данных
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60

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

// Обновляет запись пользователя и его ник/имя; change возвращает null, если счётчики менять не нужно
async function touchUser(kv: KV, profile: Profile, change: (s: UserStats, now: number) => UserStats | null) {
  const key = `user:${profile.id}`
  const now = Date.now()
  const { metadata } = await kv.getWithMetadata<UserStats>(key)
  const current: UserStats = metadata ?? { first: now, last: now, starts: 0, opens: 0 }
  const changed = change(current, now)
  const profileChanged = current.username !== profile.username || current.name !== profile.name
  // ни счётчики, ни ник с именем не поменялись — KV не трогаем (лимит записей)
  if (!changed && !profileChanged) return
  await kv.put(key, '', {
    metadata: { ...(changed ?? current), username: profile.username, name: profile.name, last: now },
  })
}

async function recordStart(message: Message, env: Env): Promise<void> {
  if (!env.STATS || !message.from) return
  await touchUser(env.STATS, profileOf(message.from), (s) => ({ ...s, starts: s.starts + 1 }))
}

async function recordOpen(profile: Profile, env: Env): Promise<void> {
  if (!env.STATS) throw new Error('KV namespace STATS не подключён (wrangler.jsonc → kv_namespaces)')
  await touchUser(env.STATS, profile, (s, now) =>
    s.lastOpen && now - s.lastOpen < OPEN_THROTTLE_MS ? null : { ...s, opens: (s.opens ?? 0) + 1, lastOpen: now },
  )
}

// ---------- подпись initData мини-приложения ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Возвращает пользователя, если initData подписан нашим ботом и не старше суток; иначе null
async function verifyInitData(initData: string, env: Env): Promise<Profile | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  const secret = await hmac(new TextEncoder().encode('WebAppData'), env.BOT_TOKEN)
  const dataCheck = (skip: string[]) =>
    [...params.entries()]
      .filter(([key]) => !skip.includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n')
  // поле signature (для сторонней проверки) клиенты присылают не всегда; в строку для hash
  // по документации оно входит, но на случай расхождений проверяем оба варианта
  const candidates = [dataCheck(['hash']), dataCheck(['hash', 'signature'])]
  let valid = false
  for (const candidate of candidates) {
    if (toHex(await hmac(secret, candidate)) === hash) valid = true
  }
  if (!valid) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null
  try {
    const user = JSON.parse(params.get('user') ?? '') as Partial<TelegramUser>
    return typeof user.id === 'number' ? profileOf(user as TelegramUser) : null
  } catch {
    return null
  }
}

type UserRecord = UserStats & { id: number }

async function allUsers(kv: KV): Promise<UserRecord[]> {
  const users: UserRecord[] = []
  let cursor: string | undefined
  do {
    const page = await kv.list<UserStats>({ prefix: 'user:', cursor })
    for (const key of page.keys) {
      if (key.metadata) users.push({ ...key.metadata, id: Number(key.name.slice('user:'.length)) })
    }
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

  const users = (await allUsers(env.STATS)).sort((a, b) => b.last - a.last) // последние сверху
  const now = Date.now()
  const count = (pred: (u: UserStats) => boolean) => users.filter(pred).length
  const totalOpens = users.reduce((sum, u) => sum + (u.opens ?? 0), 0)
  const since = users.length ? Math.min(...users.map((u) => u.first)) : now

  const header = `📊 <b>Статистика бота</b>

👥 Пользователей: <b>${users.length}</b>
📱 Открытий приложения: <b>${totalOpens}</b> (людей: <b>${count((u) => (u.opens ?? 0) > 0)}</b>)
▶️ Нажимали /start: <b>${count((u) => u.starts > 0)}</b>
🆕 Новых за 7 дней: <b>${count((u) => u.first >= now - 7 * DAY_MS)}</b>
🔥 Были за сутки: <b>${count((u) => u.last >= now - DAY_MS)}</b>`
  const footer = `\n\n<i>Данные с ${formatMsk(since)} МСК: раньше бот ничего не записывал. Открытия одного человека в течение 10 минут считаются за одно.</i>`

  // список «кто заходил»; Telegram не примет сообщение длиннее 4096 символов
  const lines: string[] = []
  let length = header.length + footer.length + 40
  for (const [i, user] of users.entries()) {
    const line = `${i + 1}. ${userLabel(user, env)} — ${userActivity(user)}`
    if (length + line.length + 1 > 4000) {
      lines.push(`…и ещё ${users.length - i}`)
      break
    }
    lines.push(line)
    length += line.length + 1
  }
  const list = lines.length ? `\n\n<b>Кто заходил</b> (последние сверху):\n${lines.join('\n')}` : ''

  await reply(env, message, header + list + footer)
}

// @ник, а если его нет — имя со ссылкой на профиль
function userLabel(user: UserRecord, env: Env): string {
  const label = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${user.id}">${escapeHtml(user.name || `id ${user.id}`)}</a>`
  return String(user.id) === env.OWNER_ID?.trim() ? `${label} (вы)` : label
}

function userActivity(user: UserStats): string {
  return [
    user.opens ? `📱 ${user.opens}` : null,
    user.starts ? `▶️ ${user.starts}` : null,
    formatMsk(user.last),
  ]
    .filter(Boolean)
    .join(' · ')
}

// «19.10 16:07» по Москве
function formatMsk(ms: number): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`
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

    if (url.pathname === '/seen' && request.method === 'POST') {
      // приложение шлёт text/plain в режиме no-cors — без CORS-заголовков и предзапросов
      const profile = await verifyInitData(await request.text(), env)
      if (profile === null) return new Response('forbidden', { status: 403 })
      try {
        await recordOpen(profile, env)
        return new Response('ok')
      } catch (err) {
        console.error('Открытие приложения не записалось:', err)
        return new Response('error', { status: 500 })
      }
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
