// Запросы Подслушано к боту (bot/src/board.ts). Обычный пользователь получает только псевдонимы.
import { ApiError, callBot } from '../api'

// одна доска на весь ГУУ; в базе её id — «all» (бывшая «Общая»)
export type BoardId = 'all'
export type Reaction = { emoji: string; count: number; me: boolean }
export type Message = {
  id: number
  alias: string
  origin: string | null // «1 курс, ИУПСиБК» — если автор включил в профиле
  text: string
  at: number
  reply_to: number | null
  reply: { alias: string | null; text: string | null } | null
  reactions: Reaction[]
  mine: boolean
  // только для админа
  author?: { id: number; name: string | null; username: string | null }
  hidden?: boolean
  reports?: number
}
type Removed = { id: number; removed: true }

export type BoardConfig = {
  reactions: string[]
  message_length: number
  keep_days: number
}
export type Entered = {
  rules: true
  admin: boolean
  board: BoardId
  alias: string
  banned_until: number | null
  config: BoardConfig
}
export type EnterResult = Entered | { rules: false }

export const isRemoved = <T extends { id: number }>(item: T | Removed): item is Removed => 'removed' in item

type ChatPage = { cursor: number; messages: (Message | Removed)[]; has_more: boolean; banned_until: number | null }

export const boardApi = {
  enter: () => callBot<EnterResult>('/board/enter'),
  accept: () => callBot<Entered>('/board/accept'),
  chat: (board: BoardId, since: number, before?: number) =>
    callBot<ChatPage>('/board/poll', { board, mode: 'chat', since, before }),
  send: (board: BoardId, text: string, replyTo: number | null) =>
    callBot<{ message: Message }>('/board/send', { board, text, reply_to: replyTo }),
  react: (id: number, emoji: string, on: boolean) =>
    callBot<{ id: number; reactions: Reaction[] }>('/board/react', { id, emoji, on }),
  report: (id: number) => callBot('/board/report', { id }),
  remove: (id: number) => callBot('/board/delete', { id }),
  // подпись «курс, институт» у псевдонима (переключатель в профиле)
  origin: (on: boolean) => callBot<{ on: boolean; label: string | null }>('/board/origin', { on }),
}

// Текст ошибки для человека
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError) || err.status === 0) return 'Нет связи. Попробуй ещё раз.'
  switch (err.code) {
    case 'filter':
      return 'Сообщение не прошло фильтр'
    case 'slow':
      return 'Не так быстро — одно сообщение в 5 секунд'
    case 'day-limit':
      return 'На сегодня лимит сообщений — продолжим завтра'
    case 'too-long':
      return 'Слишком длинное сообщение'
    case 'board-banned':
      return 'Тебе запрещено писать в Подслушано'
    case 'no-group':
      return 'Сначала выбери группу в профиле'
    case 'gone':
      return 'Сообщение уже удалено'
    case 'not-configured':
      return 'Подслушано скоро заработает'
    default:
      return 'Что-то сломалось 🛠'
  }
}
