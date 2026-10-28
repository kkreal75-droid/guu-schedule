// Запросы админ-панели к боту (bot/src/admin-api.ts). Каждый проверяется в боте: подпись + OWNER_ID.
import { normalizeGroup, shortName, type AudienceFilter } from '../../shared/groups'
import { callBot } from '../api'
import type { CalendarEdit, PeriodDraft } from '../../shared/calendar-core'
import type { PlaceEdit } from '../places'
import type { HiddenLesson, HideScope, ScheduleEdit } from '../../shared/edits-core'

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
  review_banned_until: number | null
  role: 'student' | 'teacher' | null
  teacher_id: string | null
  access: 'free_forever' | 'standard' // ни на что не влияет
  starosta_of: string | null // староста этой группы
}

export type UserCard = {
  user: AdminUser & { owner: boolean }
  visits: { ts: number; kind: string }[]
  visit_log_total: number
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
  text_en: string | null
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
  maintenance: { on: boolean; text: string; text_en?: string }
  notice: { on: boolean; id: number; text: string; text_en?: string }
  channel?: string
}

// «Скрытые пары»: какие пары люди скрывают у себя (по группам) — подсказка, если скрыли ≥ 60% группы
export type HiddenWindow = {
  group: string
  weekday: number
  start: string
  subject: string
  kind: string | null
  scope: HideScope
  users: number
  members: number
  share: number
  suggest: boolean
  done: boolean // уже скрыта для всей группы
}
export type HiddenOverview = { windows: HiddenWindow[]; group: HiddenLesson[]; people: number; rules: number }

// «Переводы» (этап 11): правки английских названий ГУУ поверх словарей data/i18n/*.en.json
export type TranslationKind = 'subject' | 'institute' | 'direction' | 'program'
export type TranslationEdit = { kind: TranslationKind; ru: string; en: string; updated_at: number }

// вебхук бота в Telegram (bot/src/setup.ts → webhookCheck)
export type BotStatus = {
  expected: string
  url: string
  url_ok: boolean
  updates_ok: boolean
  pending: number
  last_error_at: number | null
  last_error: string | null
  fresh_error: boolean
}

export const adminApi = {
  dashboard: () => callBot<Dashboard>('/admin/dashboard'),
  botStatus: () => callBot<BotStatus>('/admin/bot-status'),
  botSetup: () => callBot<BotStatus>('/admin/bot-setup'),
  users: () => callBot<{ users: AdminUser[] }>('/admin/users'),
  user: (id: number) => callBot<UserCard>('/admin/user', { id }),
  ban: (id: number, reason: string) => callBot<UserCard>('/admin/ban', { id, reason }),
  unban: (id: number) => callBot<UserCard>('/admin/unban', { id }),
  reviewBan: (id: number, days: number | null) => callBot<UserCard>('/admin/review-ban', { id, days }),
  reviews: (reports: boolean, before?: number) =>
    callBot<{ reviews: ReviewRow[]; has_more: boolean }>('/admin/reviews', { reports, before }),
  reviewModerate: (id: number, action: 'del' | 'ban' | 'keep') => callBot<{ result: string }>('/admin/review-moderate', { id, action }),
  places: () => callBot<{ edits: PlaceEdit[] }>('/admin/places'),
  academic: () => callBot<{ edits: CalendarEdit[] }>('/admin/academic'),
  academicSave: (scope: string, periods: PeriodDraft[], doc: boolean) =>
    callBot<{ edits: CalendarEdit[] }>('/admin/academic-save', { scope, periods, doc }),
  academicReset: (scope: string) => callBot<{ edits: CalendarEdit[] }>('/admin/academic-reset', { scope }),
  placeSave: (id: string | null, place: object) => callBot<{ id: string; edits: PlaceEdit[] }>('/admin/place-save', { id, place }),
  placeReset: (id: string) => callBot<{ edits: PlaceEdit[] }>('/admin/place-reset', { id }),
  exportCsv: () => callBot('/admin/export'),
  broadcastInfo: () => callBot<{ counts: Record<'all' | '1-1' | '1-2', number>; history: BroadcastRow[] }>('/admin/broadcast-info'),
  broadcastCount: (audience: Audience) => callBot<{ count: number }>('/admin/broadcast-count', { audience }),
  access: (id: number, access: AdminUser['access']) => callBot<UserCard>('/admin/access', { id, access }),
  starosta: (id: number, group: string | null) => callBot<UserCard>('/admin/starosta', { id, group }),
  // textEn — английский вариант (получателям с английским языком); пусто — всем русский
  broadcast: (text: string, textEn: string, photo: string | null, audience: Audience | null) =>
    callBot<{ id: number | null; total: number | null }>('/admin/broadcast', { text, text_en: textEn.trim() || null, photo, audience }),
  schedule: () => callBot<ScheduleStatus>('/admin/schedule'),
  hidden: () => callBot<HiddenOverview>('/admin/hidden'),
  translations: () => callBot<{ edits: TranslationEdit[] }>('/admin/translations'),
  translationSave: (kind: TranslationKind, ru: string, en: string) =>
    callBot<{ edits: TranslationEdit[] }>('/admin/translation-save', { kind, ru, en }),
  hideForGroup: (w: Pick<HiddenWindow, 'group' | 'weekday' | 'start' | 'subject' | 'kind' | 'scope'>) =>
    callBot<HiddenOverview>('/admin/hidden-group-add', w),
  unhideForGroup: (id: number) => callBot<HiddenOverview>('/admin/hidden-group-delete', { id }),
  updateNow: (force: boolean) => callBot('/admin/update-now', { force }),
  editAdd: (edit: { groups: string[]; date: string; start: string | null; kind: 'cancel' | 'note'; text: string }) =>
    callBot<{ edits: ScheduleStatus['edits'] }>('/admin/edit-add', edit),
  editDelete: (id: number) => callBot<{ edits: ScheduleStatus['edits'] }>('/admin/edit-delete', { id }),
  settings: () => callBot<{ settings: Settings }>('/admin/settings'),
  saveSettings: (settings: Omit<Settings, 'notice'> & { notice: { on: boolean; text: string; text_en?: string } }) =>
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

