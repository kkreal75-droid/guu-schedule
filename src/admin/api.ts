// Запросы админ-панели к боту (bot/src/admin-api.ts). Каждый проверяется в боте: подпись + OWNER_ID.
import { normalizeGroup, shortName, type AudienceFilter } from '../../shared/groups'
import { callBot } from '../api'
import type { SportData, SportSection, SportSession } from '../../shared/sport-core'
import type { ScheduleEdit } from '../../shared/edits-core'

export type Dashboard = {
  users: {
    total: number
    day: number
    week: number
    month: number
    opens: number
    g11: number
    g12: number
    other: number // другие группы ГУУ
    teachers: number
    banned: number
    blocked: number
  }
  new_by_day: { day: string; n: number }[]
  opens_by_hour: number[]
  chats: { total: number; g11: number; g12: number; digests: number }
  calendar: { total: number; active: number }
  board: { members: number; messages_day: number; messages_week: number; reports: number }
  reviews: { reviews: number; teachers: number; week: number; reports: number }
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
  review_banned_until: number | null
  role: 'student' | 'teacher' | null
  teacher_id: string | null
  access: 'free_forever' | 'standard' // будущая оплата: только структура, сейчас всё бесплатно
  starosta_of: string | null // староста этой группы
}

export type BoardMessageRow = {
  id: number
  board: string
  alias: string
  origin?: string | null
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
  board: { rules_accepted_at: number | null } | null
  messages: BoardMessageRow[]
  calendar: { grp: string; created_at: number; last_fetch_at: number | null; fetch_count: number } | null
  reviews: { id: number; teacher_id: string; rating: number; text: string; discipline: string | null; created_at: number; deleted: number; hidden: number }[]
}

// отзыв о преподавателе в админке: с автором и открытыми жалобами
export type ReviewRow = {
  id: number
  teacher_id: string
  teacher_name: string
  user_id: number
  grp: string | null
  rating: number
  text: string
  discipline: string | null
  created_at: number
  updated_at: number
  hidden: number
  name: string | null
  username: string | null
  reports: number
}

export type Audience = 'all' | '1-1' | '1-2' | AudienceFilter
export type BroadcastRow = {
  id: number
  created_at: number
  text: string
  photo: boolean
  audience: string | null
  audience_title: string
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
  edits: (ScheduleEdit & { created_at: number; reverted_at: number | null; author_id: number | null })[]
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
  channel?: string
}

export const adminApi = {
  dashboard: () => callBot<Dashboard>('/admin/dashboard'),
  users: () => callBot<{ users: AdminUser[] }>('/admin/users'),
  user: (id: number) => callBot<UserCard>('/admin/user', { id }),
  ban: (id: number, reason: string) => callBot<UserCard>('/admin/ban', { id, reason }),
  unban: (id: number) => callBot<UserCard>('/admin/unban', { id }),
  boardBan: (id: number, days: number | null) => callBot<UserCard>('/admin/board-ban', { id, days }),
  reviewBan: (id: number, days: number | null) => callBot<UserCard>('/admin/review-ban', { id, days }),
  reviews: (reports: boolean, before?: number) =>
    callBot<{ reviews: ReviewRow[]; has_more: boolean }>('/admin/reviews', { reports, before }),
  reviewModerate: (id: number, action: 'del' | 'ban' | 'keep') => callBot<{ result: string }>('/admin/review-moderate', { id, action }),
  sport: () => callBot<SportData>('/admin/sport'),
  sportSectionSave: (section: Partial<SportSection>) => callBot<SportData>('/admin/sport-section-save', section),
  sportSectionDelete: (id: number) => callBot<SportData>('/admin/sport-section-delete', { id }),
  sportSessionSave: (session: Partial<SportSession>) => callBot<SportData>('/admin/sport-session-save', session),
  sportSessionDelete: (id: number) => callBot<SportData>('/admin/sport-session-delete', { id }),
  sportImport: (rows: object[]) => callBot<SportData & { imported: number }>('/admin/sport-import', { rows }),
  exportCsv: () => callBot('/admin/export'),
  broadcastInfo: () => callBot<{ counts: Record<'all' | '1-1' | '1-2', number>; history: BroadcastRow[] }>('/admin/broadcast-info'),
  broadcastCount: (audience: Audience) => callBot<{ count: number }>('/admin/broadcast-count', { audience }),
  access: (id: number, access: AdminUser['access']) => callBot<UserCard>('/admin/access', { id, access }),
  starosta: (id: number, group: string | null) => callBot<UserCard>('/admin/starosta', { id, group }),
  broadcast: (text: string, photo: string | null, audience: Audience | null) =>
    callBot<{ id: number | null; total: number | null }>('/admin/broadcast', { text, photo, audience }),
  reports: () => callBot<{ reports: BoardMessageRow[] }>('/admin/reports'),
  moderate: (id: number, action: 'del' | 'ban' | 'ign') => callBot<{ result: string }>('/admin/moderate', { id, action }),
  feed: (before?: number) => callBot<{ messages: BoardMessageRow[]; has_more: boolean }>('/admin/feed', { before }),
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

export const shortGroup = (group: string | null | undefined) => (group ? shortName(normalizeGroup(group) ?? group) : '—')

export const userName = (u: { name?: string | null; username?: string | null; id?: number; user_id?: number }) =>
  u.username ? `@${u.username}` : u.name || `id ${u.id ?? u.user_id}`

