// Ручные правки расписания (админ-панель): «пара отменена» или пометка к паре / ко всему дню.
// Видны в приложении, inline, беседах, /today и календаре. Таблица — migrations/0004.
import { MB_IDS, normalizeGroup } from '../../shared/groups'

export type ScheduleEdit = {
  id: number
  group: string // id группы («b1-mb-mp-1»)
  date: string // ГГГГ-ММ-ДД
  start: string | null // начало пары; null — ко всему дню
  kind: 'cancel' | 'note'
  text: string
  created_at: number
}

const MEMORY_TTL_MS = 60_000
let cached: { at: number; edits: ScheduleEdit[] } | null = null

export async function loadEdits(env: Env): Promise<ScheduleEdit[]> {
  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.edits
  const { results } = await env.DB.prepare(
    'SELECT id, grp AS "group", date, start, kind, text, created_at FROM schedule_edits ORDER BY date, start, id',
  ).all<ScheduleEdit>()
  // старые записи — с именем группы («МБ(МП) 1-1»)
  const edits = results.map((e) => ({ ...e, group: normalizeGroup(e.group) ?? e.group }))
  cached = { at: Date.now(), edits }
  return edits
}

const invalidate = () => {
  cached = null
}

export type NewEdit = { groups: string[]; date: string; start: string | null; kind: 'cancel' | 'note'; text: string }

// Проверка правки из панели; null — всё хорошо, иначе текст ошибки
export function editProblem(edit: Partial<NewEdit>): string | null {
  if (!edit.groups?.length || !edit.groups.every((g) => MB_IDS.includes(g))) return 'Выберите группу'
  if (!edit.date || !/^\d{4}-\d{2}-\d{2}$/.test(edit.date) || Number.isNaN(Date.parse(edit.date))) return 'Выберите дату'
  if (edit.start !== null && (typeof edit.start !== 'string' || !/^\d{2}:\d{2}$/.test(edit.start))) return 'Выберите пару'
  if (edit.kind !== 'cancel' && edit.kind !== 'note') return 'Выберите, что сделать'
  if (edit.kind === 'cancel' && edit.start === null) return 'Отменить можно только конкретную пару'
  const text = typeof edit.text === 'string' ? edit.text.trim() : ''
  if (edit.kind === 'note' && !text) return 'Напишите текст пометки'
  if (text.length > 300) return 'Слишком длинный текст — до 300 символов'
  return null
}

export async function addEdits(env: Env, edit: NewEdit): Promise<void> {
  const now = Date.now()
  await env.DB.batch(
    edit.groups.map((group) =>
      env.DB.prepare('INSERT INTO schedule_edits (grp, date, start, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        group,
        edit.date,
        edit.start,
        edit.kind,
        edit.text.trim(),
        now,
      ),
    ),
  )
  invalidate()
}

export async function deleteEdit(env: Env, id: number): Promise<boolean> {
  const { meta } = await env.DB.prepare('DELETE FROM schedule_edits WHERE id = ?').bind(id).run()
  invalidate()
  return meta.changes > 0
}
