// Настройка бота в Telegram: вебхук на этот воркер и меню команд.
// Запускается через GET / (?force — принудительно, например после деплоя).
import { webhookSecret } from './auth'
import { tg } from './telegram'

type WebhookInfo = {
  url?: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  allowed_updates?: string[]
}

const ALLOWED_UPDATES = ['message', 'callback_query', 'inline_query', 'my_chat_member']

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
]

export async function setupBot(env: Env, origin: string, force: boolean) {
  const url = `${origin}/webhook`
  let info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
  let changed = false
  const sameUpdates = ALLOWED_UPDATES.every((u) => info.allowed_updates?.includes(u))
  if (force || info.url !== url || !sameUpdates) {
    await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ALLOWED_UPDATES })
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
