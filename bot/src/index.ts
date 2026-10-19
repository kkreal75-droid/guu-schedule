// Бот «Расписание ГУУ» на Cloudflare Workers.
//
//   POST /webhook — сюда Telegram присылает сообщения; на /start бот отвечает приветствием
//                   и кнопкой, которая открывает мини-приложение (WEBAPP_URL).
//   GET  /        — регистрирует вебхук на этот воркер (достаточно открыть адрес в браузере);
//                   ?force — перерегистрировать, даже если адрес уже тот же.
//
// Секрет один — BOT_TOKEN (npx wrangler secret put BOT_TOKEN). Из него же получается ключ
// вебхука: Telegram кладёт его в заголовок каждого запроса, чужие запросы отбрасываем.

export interface Env {
  BOT_TOKEN: string
  WEBAPP_URL: string
  TELEGRAM_API?: string // только для локальной проверки с поддельным Telegram
}

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void }

type Update = {
  message?: {
    text?: string
    chat: { id: number; type: string }
    from?: { first_name?: string }
  }
}

type ApiResult = { ok: boolean; description?: string; result?: { url?: string } }

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

async function telegram(env: Env, method: string, body: unknown): Promise<ApiResult> {
  const base = env.TELEGRAM_API || 'https://api.telegram.org'
  const res = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as ApiResult
  if (!data.ok) console.error(`Telegram ${method}: ${data.description}`)
  return data
}

async function handleUpdate(update: Update, env: Env): Promise<void> {
  const message = update.message
  // «/start», «/start@имя_бота», «/start что-то»
  const command = message?.text?.trim().split(/\s+/)[0].split('@')[0]
  if (!message || command !== '/start') return

  const name = escapeHtml(message.from?.first_name?.trim() || 'брат')
  const greet = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
  // кнопки web_app Telegram разрешает только в личных чатах; в группе — обычная ссылка
  const button =
    message.chat.type === 'private'
      ? { text: '📅 Открыть расписание', web_app: { url: env.WEBAPP_URL } }
      : { text: '📅 Открыть расписание', url: env.WEBAPP_URL }

  await telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: greet(name),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[button]] },
  })
}

async function ensureWebhook(env: Env, origin: string, force: boolean) {
  const url = `${origin}/webhook`
  const info = await telegram(env, 'getWebhookInfo', {})
  if (!force && info.ok && info.result?.url === url) return { ok: true, webhook: url, changed: false }
  const set = await telegram(env, 'setWebhook', {
    url,
    secret_token: await webhookSecret(env),
    allowed_updates: ['message'],
  })
  return { ok: set.ok, webhook: url, changed: true, error: set.description }
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
      const result = await ensureWebhook(env, url.origin, url.searchParams.has('force'))
      return Response.json(result, { status: result.ok ? 200 : 502 })
    }

    return new Response('not found', { status: 404 })
  },
}
