// Запросы доски к боту (bot/src/board.ts). Обычный пользователь получает только псевдонимы.
import { ApiError, callBot } from '../api'

export type BoardId = 'g11' | 'g12' | 'all'
export type BoardInfo = { id: BoardId; title: string; alias: string }
export type Reaction = { emoji: string; count: number; me: boolean }
export type Message = {
  id: number
  alias: string
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
export type Stroke = { id: number; c: string; w: number; p: number[]; mine: boolean; by?: number }
type Removed = { id: number; removed: true }

export type BoardConfig = {
  colors: string[]
  widths: number[]
  reactions: string[]
  message_length: number
  points_per_stroke: number
  keep_days: number
}
export type Entered = {
  rules: true
  admin: boolean
  group: string
  boards: BoardInfo[]
  banned_until: number | null
  config: BoardConfig
}
export type EnterResult = Entered | { rules: false; group: string }

export const isRemoved = <T extends { id: number }>(item: T | Removed): item is Removed => 'removed' in item

type ChatPage = { cursor: number; messages: (Message | Removed)[]; has_more: boolean; banned_until: number | null }
type DrawPage = { cursor: number; strokes: (Stroke | Removed)[]; banned_until: number | null }

export const boardApi = {
  enter: (group: string) => callBot<EnterResult>('/board/enter', { group }),
  accept: (group: string) => callBot<Entered>('/board/accept', { group }),
  chat: (board: BoardId, since: number, before?: number) =>
    callBot<ChatPage>('/board/poll', { board, mode: 'chat', since, before }),
  send: (board: BoardId, text: string, replyTo: number | null) =>
    callBot<{ message: Message }>('/board/send', { board, text, reply_to: replyTo }),
  react: (id: number, emoji: string, on: boolean) =>
    callBot<{ id: number; reactions: Reaction[] }>('/board/react', { id, emoji, on }),
  report: (id: number) => callBot('/board/report', { id }),
  remove: (id: number) => callBot('/board/delete', { id }),
  draw: (board: BoardId, since: number) => callBot<DrawPage>('/board/poll', { board, mode: 'draw', since }),
  stroke: (board: BoardId, color: string, width: number, points: number[]) =>
    callBot<{ stroke: Stroke }>('/board/stroke', { board, color, width, points }),
  undo: (board: BoardId) => callBot<{ id: number | null }>('/board/undo', { board }),
  erase: (board: BoardId, ids: number[]) => callBot<{ ids: number[] }>('/board/erase', { board, ids }),
  clear: (board: BoardId, png: string) => callBot<{ snapshot: number; strokes: number }>('/board/clear', { board, png }),
}

// Текст ошибки для человека; draw — ошибки рисовалки (лимиты там свои)
export function errorText(err: unknown, draw = false): string {
  if (!(err instanceof ApiError) || err.status === 0) return 'Нет связи. Попробуй ещё раз.'
  switch (err.code) {
    case 'filter':
      return 'Сообщение не прошло фильтр'
    case 'slow':
      return draw ? 'Слишком много штрихов — подожди минуту' : 'Не так быстро — одно сообщение в 5 секунд'
    case 'day-limit':
      return draw ? 'На сегодня штрихов хватит — продолжим завтра' : 'На сегодня лимит сообщений — продолжим завтра'
    case 'too-long':
      return 'Слишком длинное сообщение'
    case 'board-banned':
      return 'Тебе запрещено писать на доске'
    case 'gone':
      return 'Сообщение уже удалено'
    case 'not-configured':
      return 'Доска скоро заработает'
    default:
      return 'Что-то сломалось 🛠'
  }
}
