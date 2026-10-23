// Настройка бота в Telegram: вебхук на этот воркер и меню команд, присмотр за вебхуком.
// Адрес вебхука — только из конфигурации (vars.WEBHOOK_URL в wrangler.jsonc: https, путь /webhook), никогда из
// входящего запроса. Публичного адреса настройки нет: настраивают владелец (админ-панель, /webhook fix) и cron —
// раз в 10 минут и после каждого деплоя он сверяет getWebhookInfo, чинит сброшенный вебхук и пишет владельцу.
import { webhookSecret } from './auth'
import { sendMessage, tg } from './telegram'
import { escapeHtml } from './util'

type WebhookInfo = {
  url?: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  allowed_updates?: string[]
}

const ALLOWED_UPDATES = ['message', 'callback_query', 'inline_query', 'my_chat_member']

// WEBHOOK_URL из конфигурации; не https://…/webhook — ошибка (автотесты и npm run deploy ловят её до прода)
export function webhookUrl(env: Env): string {
  const raw = String((env as { WEBHOOK_URL?: unknown }).WEBHOOK_URL ?? '')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('WEBHOOK_URL не задан в wrangler.jsonc')
  }
  if (url.protocol !== 'https:' || url.pathname !== '/webhook' || url.search || url.hash || url.username) {
    throw new Error(`WEBHOOK_URL должен быть https://…/webhook, сейчас: ${raw}`)
  }
  return url.toString()
}

const FRESH_ERROR_MS = 15 * 60_000 // ошибка доставки за последние 15 минут — «свежая»
const MAX_PENDING = 20

export type WebhookCheck = {
  expected: string
  url: string // что стоит в Telegram ('' — вебхук сброшен)
  url_ok: boolean
  updates_ok: boolean
  pending: number
  last_error_at: number | null
  last_error: string | null
  fresh_error: boolean
}

export async function webhookCheck(env: Env, now = Date.now()): Promise<WebhookCheck> {
  const expected = webhookUrl(env)
  const info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
  const at = info.last_error_date ? info.last_error_date * 1000 : null
  return {
    expected,
    url: info.url ?? '',
    url_ok: info.url === expected,
    updates_ok: ALLOWED_UPDATES.every((u) => info.allowed_updates?.includes(u)),
    pending: info.pending_update_count ?? 0,
    last_error_at: at,
    last_error: info.last_error_message ?? null,
    fresh_error: at !== null && now - at < FRESH_ERROR_MS,
  }
}

// Только вебхук (меню команд и описание не трогаем): drop_pending_updates нет — накопившееся Telegram дошлёт
const setWebhook = async (env: Env) =>
  tg(env, 'setWebhook', { url: webhookUrl(env), secret_token: await webhookSecret(env), allowed_updates: ALLOWED_UPDATES })

const ALERT_KEY = 'webhook-alert' // KV: тревога о вебхуке — не чаще раза в 30 минут
const ALERT_TTL = 30 * 60
const VERSION_KEY = 'worker-version' // KV: какую версию воркера уже проверили после деплоя
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Присмотр за вебхуком (cron раз в 10 минут и после деплоя): сброшен или стоит не туда — ставим свой и пишем
// владельцу; свежая ошибка доставки или очередь > 20 — тревога. Тревоги — не чаще раза в 30 минут (deploy — всегда).
export async function watchWebhook(env: Env, now = Date.now(), note: string | null = null): Promise<number> {
  const check = await webhookCheck(env, now)
  const problems: string[] = []
  if (!check.url_ok || !check.updates_ok) {
    await setWebhook(env)
    const fixed = await webhookCheck(env, now)
    const status = fixed.url_ok ? 'поставил свой заново' : `поставить свой не вышло (сейчас: ${fixed.url || 'пусто'})`
    if (!check.url) problems.push(`Вебхук был сброшен (пустой адрес) — ${status}.`)
    else if (hostOf(check.url) !== hostOf(check.expected)) {
      problems.push(`Вебхук указывал на ЧУЖОЙ адрес ${hostOf(check.url)} — ${status}. Токен бота мог утечь: перевыпусти его в BotFather.`)
    } else if (!check.url_ok) problems.push(`Вебхук стоял на ${check.url} — ${status}.`)
    else problems.push(`У вебхука не те типы обновлений — ${status}.`)
  }
  if (check.fresh_error) {
    const time = new Date(check.last_error_at!).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
    problems.push(`Telegram не смог доставить обновление в ${time}: «${check.last_error}».`)
  }
  if (check.pending > MAX_PENDING) problems.push(`В очереди Telegram ${check.pending} обновлений (бот не успевает или не получает их).`)
  if (!problems.length && !note) return 1
  if (!note && (await env.KV.get(ALERT_KEY))) return 2
  if (problems.length) await env.KV.put(ALERT_KEY, '1', { expirationTtl: ALERT_TTL })
  const lines = [note, ...problems].filter((l): l is string => Boolean(l)).map(escapeHtml)
  const head = problems.length ? '🚨 <b>Бот в Telegram</b>' : '✅ <b>Бот в Telegram</b>'
  await sendMessage(env, Number(env.OWNER_ID), `${head}\n${lines.join('\n')}`)
  return 4
}

// После деплоя или отката (новая версия воркера) — сразу проверка вебхука. Откат (версия старше прошлой проверенной) —
// сообщение владельцу всегда; обычный деплой — только если с вебхуком что-то не так.
let checkedVersion: string | null = null
export async function afterDeploy(env: Env, now = Date.now()): Promise<number> {
  const meta = (env as { CF_VERSION_METADATA?: { id?: string; timestamp?: string } }).CF_VERSION_METADATA
  if (!meta?.id || checkedVersion === meta.id) return 0
  const saved = await env.KV.get<{ id: string; timestamp: string }>(VERSION_KEY, 'json')
  checkedVersion = meta.id
  if (saved?.id === meta.id) return 1
  await env.KV.put(VERSION_KEY, JSON.stringify({ id: meta.id, timestamp: meta.timestamp ?? '' }))
  const rollback = Boolean(saved?.timestamp && meta.timestamp && meta.timestamp < saved.timestamp)
  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const note = rollback
    ? `↩️ Воркер откатился на версию ${meta.id.slice(0, 8)} от ${when(meta.timestamp)} (была ${saved!.id.slice(0, 8)} от ${when(saved!.timestamp)}). Вебхук проверен.`
    : null
  return 2 + (await watchWebhook(env, now, note))
}

// Строка о данных в описании бота (экран «Что умеет этот бот?») — дописываем, если её нет
const PRIVACY_LINE = 'Бот считает визиты для статистики, данные никому не передаются.'
const DESCRIPTION_LIMIT = 512

async function ensurePrivacyLine(env: Env): Promise<{ updated: boolean; description: string }> {
  const current = await tg<{ description?: string } | true>(env, 'getMyDescription', {})
  const description = typeof current === 'object' && typeof current.description === 'string' ? current.description : ''
  if (description.includes(PRIVACY_LINE)) return { updated: false, description }
  const next = description ? `${description}\n\n${PRIVACY_LINE}` : PRIVACY_LINE
  if (next.length > DESCRIPTION_LIMIT) throw new Error('Описание бота слишком длинное, строка о данных не помещается')
  await tg(env, 'setMyDescription', { description: next })
  return { updated: true, description: next }
}

// Английская версия (этап 11): описание, короткое описание и меню команд для тех, у кого Telegram по-английски
// (language_code=en). Описание — публичное (экран «Что умеет этот бот?»), ставим только если отличается.
const DESCRIPTION_EN = `The whole GUU schedule 📅
• your group's classes for the day and week
• even/odd weeks calculated automatically
• teachers' schedules and free classrooms
• campus buildings and how to get there
• teacher ratings
• classes in your phone calendar

Free, no subscriptions. Data from the official GUU website, updated automatically. Unofficial student project, not affiliated with GUU administration.

The bot counts visits for statistics; data is never shared.`
const SHORT_DESCRIPTION_EN = 'Free schedule for the whole GUU: classes, teachers, rooms and buildings. Student project.'

async function ensureEnglishDescription(env: Env): Promise<boolean> {
  const [long, short] = await Promise.all([
    tg<{ description?: string }>(env, 'getMyDescription', { language_code: 'en' }),
    tg<{ short_description?: string }>(env, 'getMyShortDescription', { language_code: 'en' }),
  ])
  let updated = false
  if (long.description !== DESCRIPTION_EN) {
    await tg(env, 'setMyDescription', { description: DESCRIPTION_EN, language_code: 'en' })
    updated = true
  }
  if (short.short_description !== SHORT_DESCRIPTION_EN) {
    await tg(env, 'setMyShortDescription', { short_description: SHORT_DESCRIPTION_EN, language_code: 'en' })
    updated = true
  }
  return updated
}

const PUBLIC_COMMANDS_EN = [
  { command: 'start', description: 'Open the schedule' },
  { command: 'today', description: "Today's classes" },
  { command: 'tomorrow', description: "Tomorrow's classes" },
]

const GROUP_COMMANDS_EN = [
  { command: 'today', description: "Today's classes" },
  { command: 'tomorrow', description: "Tomorrow's classes" },
  { command: 'setup', description: 'Set up: /setup or /setup group name' },
  { command: 'here', description: 'Send the schedule to this topic' },
  { command: 'off', description: 'Turn off automatic messages' },
]

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Открыть расписание' },
  { command: 'today', description: 'Пары на сегодня' },
  { command: 'tomorrow', description: 'Пары на завтра' },
]

const GROUP_COMMANDS = [
  { command: 'today', description: 'Пары на сегодня' },
  { command: 'tomorrow', description: 'Пары на завтра' },
  { command: 'setup', description: 'Настроить: /setup или /setup название группы' },
  { command: 'here', description: 'Присылать расписание в эту тему' },
  { command: 'off', description: 'Выключить автосообщения' },
]

const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: 'stats', description: 'Статистика' },
  { command: 'broadcast', description: 'Рассылка: /broadcast текст' },
  { command: 'broadcasts', description: 'Последние рассылки' },
  { command: 'export', description: 'Пользователи в CSV' },
  { command: 'ban', description: 'Бан: /ban id|@ник [причина]' },
  { command: 'unban', description: 'Разбан: /unban id' },
  { command: 'bans', description: 'Список банов' },
  { command: 'usage', description: 'Расход лимитов Cloudflare' },
  { command: 'backup', description: 'Бэкап базы сейчас' },
  { command: 'webhook', description: 'Вебхук: состояние, /webhook fix — заново' },
]

// Полная настройка (вебхук, меню команд, описание) — только владелец: админ-панель или «/webhook fix»
export async function setupBot(env: Env, force: boolean) {
  const url = webhookUrl(env)
  let info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
  let changed = false
  const sameUpdates = ALLOWED_UPDATES.every((u) => info.allowed_updates?.includes(u))
  if (force || info.url !== url || !sameUpdates) {
    await setWebhook(env)
    await tg(env, 'setMyCommands', { commands: PUBLIC_COMMANDS, scope: { type: 'default' } })
    await tg(env, 'setMyCommands', { commands: GROUP_COMMANDS, scope: { type: 'all_group_chats' } })
    await tg(env, 'setMyCommands', { commands: ADMIN_COMMANDS, scope: { type: 'chat', chat_id: Number(env.OWNER_ID) } })
    await tg(env, 'setMyCommands', { commands: PUBLIC_COMMANDS_EN, scope: { type: 'default' }, language_code: 'en' })
    await tg(env, 'setMyCommands', { commands: GROUP_COMMANDS_EN, scope: { type: 'all_group_chats' }, language_code: 'en' })
    info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
    changed = true
  }
  const description = await ensurePrivacyLine(env)
  const englishUpdated = await ensureEnglishDescription(env)
  // имя бота нужно для ссылок t.me/<бот>/schedule — сверяем с настройкой BOT_USERNAME
  const me = await tg<{ username: string; supports_inline_queries?: boolean }>(env, 'getMe', {})
  return {
    ok: true,
    bot: me.username,
    bot_username_matches: me.username === env.BOT_USERNAME,
    inline_mode: Boolean(me.supports_inline_queries),
    changed,
    // описание бота (экран «Что умеет этот бот?») — публичное
    description_updated: description.updated,
    description: description.description,
    description_en_updated: englishUpdated,
    webhook: info.url,
    allowed_updates: info.allowed_updates ?? [],
    pending_update_count: info.pending_update_count ?? 0,
    last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    last_error_message: info.last_error_message ?? null,
  }
}
