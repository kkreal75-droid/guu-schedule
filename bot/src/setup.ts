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

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Открыть расписание' },
  { command: 'today', description: 'Пары на сегодня' },
  { command: 'tomorrow', description: 'Пары на завтра' },
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
]

export async function setupBot(env: Env, origin: string, force: boolean) {
  const url = `${origin}/webhook`
  let info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
  let changed = false
  const sameUpdates = ALLOWED_UPDATES.every((u) => info.allowed_updates?.includes(u))
  if (force || info.url !== url || !sameUpdates) {
    await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ALLOWED_UPDATES })
    await tg(env, 'setMyCommands', { commands: PUBLIC_COMMANDS, scope: { type: 'default' } })
    await tg(env, 'setMyCommands', { commands: ADMIN_COMMANDS, scope: { type: 'chat', chat_id: Number(env.OWNER_ID) } })
    info = await tg<WebhookInfo>(env, 'getWebhookInfo', {})
    changed = true
  }
  return {
    ok: true,
    changed,
    webhook: info.url,
    allowed_updates: info.allowed_updates ?? [],
    pending_update_count: info.pending_update_count ?? 0,
    last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    last_error_message: info.last_error_message ?? null,
  }
}
