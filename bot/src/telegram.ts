// Обёртка над Telegram Bot API и нужные нам типы.

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
export type TgChat = { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string; is_forum?: boolean }
export type TgEntity = {
  type: string
  offset: number
  length: number
  url?: string
  language?: string
  user?: TgUser
  custom_emoji_id?: string
}
export type TgMessage = {
  message_id: number
  // супергруппа с темами: сообщение из темы (не из General) — is_topic_message и id темы
  message_thread_id?: number
  is_topic_message?: boolean
  chat: TgChat
  from?: TgUser
  date?: number
  text?: string
  entities?: TgEntity[]
  caption?: string
  caption_entities?: TgEntity[]
  photo?: { file_id: string; width: number; height: number }[]
}
export type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string }
export type TgUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
  inline_query?: { id: string; from: TgUser; query: string; chat_type?: string }
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { status: string }; old_chat_member: { status: string } }
}

export type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }
export type Keyboard = { inline_keyboard: InlineButton[][] }

// Ошибка Telegram с кодом: 403 — бот заблокирован/нельзя писать первым, 429 — подождать
export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${method}: ${description}`)
  }
}

type ApiResponse<T> = {
  ok?: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

async function parse<T>(method: string, res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as ApiResponse<T> | null
  if (!data?.ok) {
    throw new TelegramError(
      method,
      data?.error_code ?? res.status,
      data?.description ?? `HTTP ${res.status}`,
      data?.parameters?.retry_after,
    )
  }
  return data.result as T
}

const apiUrl = (env: Env, method: string) =>
  `${env.TELEGRAM_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/${method}`

// Ошибку Telegram (ok: false) превращаем в исключение — иначе её проглотят молча
export async function tg<T = unknown>(env: Env, method: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(env, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse<T>(method, res)
}

// multipart — для отправки файлов (sendDocument)
export async function tgForm<T = unknown>(env: Env, method: string, form: FormData): Promise<T> {
  return parse<T>(method, await fetch(apiUrl(env, method), { method: 'POST', body: form }))
}

export const sendMessage = (env: Env, chatId: number, text: string, extra: object = {}) =>
  tg<TgMessage>(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  })

export const answerCallback = (env: Env, id: string, text?: string) =>
  tg(env, 'answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })

// пользователь заблокировал бота, удалил аккаунт или ни разу ему не писал
export const isUnreachable = (err: unknown) => err instanceof TelegramError && err.code === 403
