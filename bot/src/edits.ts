// Ручные правки расписания (владелец — админ-панель, старосты — «Правки группы»), подгруппы и метки
// пар подгрупп, пары, скрытые владельцем для всей группы (hidden.ts). Видны в приложении, inline, беседах,
// /today и календаре (shared/edits-core.ts). Таблицы — migrations/0004, 0007, 0020. Читаем всё разом и
// держим в памяти минуту.
import { normalizeGroup } from '../../shared/groups'
import type { AddData, Extras, LessonTag, MoveData, NewEdit, ScheduleEdit, Subgroup } from '../../shared/edits-core'
import { HIDDEN_COLUMNS, hiddenFromRow, type HiddenRow } from './db'

export type { ScheduleEdit } from '../../shared/edits-core'

const MEMORY_TTL_MS = 60_000
const KEEP_DAYS = 30 // правки старше месяца назад уже не нужны для показа
let cached: { at: number; extras: Extras } | null = null

type EditRow = {
  id: number
  grp: string
  date: string
  start: string | null
  kind: ScheduleEdit['kind']
  text: string
  data: string | null
  created_at: number
  author_id: number | null
  reverted_at: number | null
}

export function editFromRow(row: EditRow, author: string | null = null): ScheduleEdit & { created_at: number } {
  let data: AddData | MoveData | null = null
  try {
    data = row.data ? (JSON.parse(row.data) as AddData | MoveData) : null
  } catch {
    data = null
  }
  return {
    id: row.id,
    group: normalizeGroup(row.grp) ?? row.grp, // старые записи — с именем группы («МБ(МП) 1-1»)
    date: row.date,
    start: row.start,
    kind: row.kind,
    text: row.text,
    data,
    author,
    created_at: row.created_at,
  }
}

const sinceIso = () => new Date(Date.now() + 3 * 3_600_000 - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)

export async function loadExtras(env: Env): Promise<Extras> {
  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.extras
  const since = sinceIso()
  const [edits, subgroups, tags, hidden] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, grp, date, start, kind, text, data, created_at, author_id, reverted_at FROM schedule_edits
       WHERE reverted_at IS NULL AND (date >= ?1 OR (kind = 'move' AND json_extract(data, '$.to_date') >= ?1))
       ORDER BY date, start, id`,
    ).bind(since),
    env.DB.prepare('SELECT id, grp, name FROM subgroups WHERE deleted = 0 ORDER BY grp, name'),
    env.DB.prepare('SELECT id, grp, weekday, start, subject, teacher, subgroup_id FROM lesson_tags ORDER BY grp, weekday, start'),
    env.DB.prepare(`SELECT ${HIDDEN_COLUMNS} FROM hidden_lessons WHERE user_id = 0 ORDER BY grp, weekday, start`),
  ])
  const extras: Extras = {
    edits: (edits.results as EditRow[]).map((r) => editFromRow(r)),
    subgroups: (subgroups.results as { id: number; grp: string; name: string }[]).map((r) => ({ id: r.id, group: r.grp, name: r.name })),
    tags: (tags.results as { id: number; grp: string; weekday: number; start: string; subject: string; teacher: string | null; subgroup_id: number }[]).map(
      (r): LessonTag => ({ id: r.id, group: r.grp, weekday: r.weekday, start: r.start, subject: r.subject, teacher: r.teacher, subgroup: r.subgroup_id }),
    ),
    hidden: (hidden.results as HiddenRow[]).map(hiddenFromRow),
  }
  cached = { at: Date.now(), extras }
  return extras
}

// Совместимость: только правки
export const loadEdits = async (env: Env) => (await loadExtras(env)).edits

export const invalidateExtras = () => {
  cached = null
}

// Правки и подгруппы только этих групп (приложению при открытии, просмотр чужой группы)
export function extrasFor(extras: Extras, groups: string[]): Extras {
  const set = new Set(groups)
  return {
    edits: extras.edits.filter((e) => set.has(e.group)),
    subgroups: extras.subgroups.filter((s) => set.has(s.group)),
    tags: extras.tags.filter((t) => set.has(t.group)),
    hidden: extras.hidden?.filter((h) => set.has(h.group)) ?? [],
  }
}

export async function addEdits(env: Env, edit: NewEdit, authorId: number | null): Promise<void> {
  const now = Date.now()
  await env.DB.batch(
    edit.groups.map((group) =>
      env.DB.prepare(
        'INSERT INTO schedule_edits (grp, date, start, kind, text, data, created_at, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(group, edit.date, edit.kind === 'add' ? (edit.data as AddData).start : edit.start, edit.kind, edit.text.trim(), edit.data ? JSON.stringify(edit.data) : null, now, authorId),
    ),
  )
  invalidateExtras()
}

// Откат: правка больше не действует, но видна владельцу в истории
export async function revertEdit(env: Env, id: number): Promise<boolean> {
  const { meta } = await env.DB.prepare('UPDATE schedule_edits SET reverted_at = ? WHERE id = ? AND reverted_at IS NULL').bind(Date.now(), id).run()
  invalidateExtras()
  return meta.changes > 0
}

export async function subgroupsOf(env: Env, group: string): Promise<Subgroup[]> {
  return (await loadExtras(env)).subgroups.filter((s) => s.group === group)
}
