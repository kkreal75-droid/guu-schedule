// Запросы админ-панели к боту (bot/src/admin-api.ts). Каждый проверяется в боте: подпись + OWNER_ID.
import { callBot, callBotBlob } from '../api'
import type { BoardId, Stroke } from '../board/api'
import type { ScheduleEdit } from '../edits'

export type Dashboard = {
  users: { total: number; day: number; week: number; month: number; opens: number; g11: number; g12: number; banned: number; blocked: number }
  new_by_day: { day: string; n: number }[]
  opens_by_hour: number[]
  chats: { total: number; g11: number; g12: number; digests: number }
  calendar: { total: number; active: number }
  board: { members: number; messages_day: number; messages_week: number; strokes_day: number; strokes_week: number; reports: number }
}

export type AdminUser = {
  id: number
  username: string | null
  name: string | null
  grp: string | null
  first_seen: number
  last_seen: number
  visits: number
  starts: number
  can_message: number
  blocked_bot: number
  banned: number
  ban_reason: string | null
  board_banned_until: number | null
}

export type BoardMessageRow = {
  id: number
  board: string
  alias: string
  text: string
  created_at: number
  deleted?: number
  hidden: number
  user_id?: number
  name?: string | null
  username?: string | null
  reports?: number
}

export type UserCard = {
  user: AdminUser & { owner: boolean }
  visits: { ts: number; kind: string }[]
  visit_log_total: number
  board: { rules_accepted_at: number | null; board_grp: string | null } | null
  messages: BoardMessageRow[]
  calendar: { grp: string; created_at: number; last_fetch_at: number | null; fetch_count: number } | null
}

export type Audience = 'all' | '1-1' | '1-2'
export type BroadcastRow = {
  id: number
  created_at: number
  text: string
  photo: boolean
  audience: Audience | null
  status: 'draft' | 'sending' | 'done' | 'cancelled'
  total: number
  delivered: number
  blocked: number
  failed: number
}

export type Run = { id: number; event: string; status: string; conclusion: string | null; created_at: string; html_url: string }
export type ScheduleStatus = {
  updated_at: string | null
  source_file: string | null
  source_sha256: string | null
  lessons: number
  edits: (ScheduleEdit & { created_at: number })[]
  // замены дней целиком из файлов репозитория (overrides/thursday.json) — только просмотр
  file_edits: FileEdit[]
  github: { token: boolean; runs: Run[] | null; error: string | null }
}

type FileLesson = { start: string; end: string; subject: string; teacher?: string | null; room?: string | null }
export type FileEdit = { file: string; group: string; weekday: number; even: FileLesson[]; odd: FileLesson[] }

export type Settings = {
  greetings: string[]
  maintenance: { on: boolean; text: string }
  notice: { on: boolean; id: number; text: string }
}

export type Snapshot = { id: number; board: string; created_at: number; strokes: number; bytes: number }

export const adminApi = {
  dashboard: () => callBot<Dashboard>('/admin/dashboard'),
  users: () => callBot<{ users: AdminUser[] }>('/admin/users'),
  user: (id: number) => callBot<UserCard>('/admin/user', { id }),
  ban: (id: number, reason: string) => callBot<UserCard>('/admin/ban', { id, reason }),
  unban: (id: number) => callBot<UserCard>('/admin/unban', { id }),
  boardBan: (id: number, days: number | null) => callBot<UserCard>('/admin/board-ban', { id, days }),
  exportCsv: () => callBot('/admin/export'),
  broadcastInfo: () => callBot<{ counts: Record<Audience, number>; history: BroadcastRow[] }>('/admin/broadcast-info'),
  broadcast: (text: string, photo: string | null, audience: Audience | null) =>
    callBot<{ id: number | null; total: number | null }>('/admin/broadcast', { text, photo, audience }),
  reports: () => callBot<{ reports: BoardMessageRow[] }>('/admin/reports'),
  moderate: (id: number, action: 'del' | 'ban' | 'ign') => callBot<{ result: string }>('/admin/moderate', { id, action }),
  feed: (board: BoardId | null, before?: number) =>
    callBot<{ messages: BoardMessageRow[]; has_more: boolean }>('/admin/feed', { board, before }),
  strokes: (board: BoardId) => callBot<{ strokes: Stroke[] }>('/admin/strokes', { board }),
  clear: (board: BoardId, png: string) => callBot<{ snapshot: number; strokes: number }>('/admin/clear', { board, png }),
  snapshots: () => callBot<{ snapshots: Snapshot[] }>('/admin/snapshots'),
  snapshot: (id: number) => callBotBlob('/admin/snapshot', { id }),
  schedule: () => callBot<ScheduleStatus>('/admin/schedule'),
  updateNow: (force: boolean) => callBot('/admin/update-now', { force }),
  editAdd: (edit: { groups: string[]; date: string; start: string | null; kind: 'cancel' | 'note'; text: string }) =>
    callBot<{ edits: ScheduleStatus['edits'] }>('/admin/edit-add', edit),
  editDelete: (id: number) => callBot<{ edits: ScheduleStatus['edits'] }>('/admin/edit-delete', { id }),
  settings: () => callBot<{ settings: Settings }>('/admin/settings'),
  saveSettings: (settings: Omit<Settings, 'notice'> & { notice: { on: boolean; text: string } }) =>
    callBot<{ settings: Settings }>('/admin/settings-save', settings),
  greetingPreview: (text: string) => callBot('/admin/greeting-preview', { text }),
}

// Ошибку бота — человеческим текстом (бот присылает готовые фразы для понятных случаев)
export function adminError(err: unknown): string {
  const code = (err as { code?: string; status?: number })?.code
  const status = (err as { status?: number })?.status
  if (status === 0 || code === undefined) return 'Нет связи с ботом. Попробуйте ещё раз.'
  if (code === 'internal') return 'Что-то сломалось 🛠'
  if (code === 'no-token') return 'Нужен секрет GITHUB_TOKEN — см. инструкцию в отчёте'
  if (code === 'forbidden') return 'Нет доступа'
  if (/^[a-z -]+$/.test(code)) return 'Что-то сломалось 🛠'
  return code // готовая фраза от бота: «Выберите пару», «Telegram не принял сообщение: …»
}

// мс → «19.10 18:07» по времени устройства
export const stamp = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const shortGroup = (group: string | null | undefined) => (group ? group.replace('МБ(МП) ', '') : '—')

export const userName = (u: { name?: string | null; username?: string | null; id?: number; user_id?: number }) =>
  u.username ? `@${u.username}` : u.name || `id ${u.id ?? u.user_id}`

export const BOARD_TITLES: Record<string, string> = { g11: '1-1', g12: '1-2', all: 'Общая' }
