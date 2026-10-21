// «Это не моя пара» (D1 hidden_lessons, migrations/0020). Человек скрывает пару у себя — она пропадает из его
// приложения, календаря (.ics по его ссылке), inline и /today в личке; другим ничего не меняется. Сводки в беседы
// общие: там действует только скрытое владельцем для всей группы (user_id = 0, админ-панель → «Скрытые пары»).
// Скрыть можно только то, что у группы в этот день правда есть (проверяем по расписанию дня).
// Подсказка владельцу: одну и ту же пару скрыли ≥ 60% людей группы (и хотя бы двое) — скорее всего, она не их.
import { dayLessons, type HiddenLesson, type HideScope } from '../../shared/edits-core'
import { normalizeGroup } from '../../shared/groups'
import { dayFromIso, isoFromDay } from '../../shared/schedule-core'
import { json, readApi } from './api'
import { forgetCalendarOf } from './calendar'
import { HIDDEN_COLUMNS, hiddenFromRow, type HiddenRow } from './db'
import { invalidateExtras } from './edits'
import { loadTimetable } from './schedule'

const MAX_PER_USER = 200
const SCOPES = ['day', 'even', 'odd', 'always'] as const
const SUGGEST_SHARE = 0.6
const SUGGEST_MIN = 2
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

// группа («b1-grb-1») или расписание преподавателя («t-<id>»)
const groupKey = (value: unknown): string | null =>
  typeof value === 'string' && /^t-[a-z0-9-]{1,80}$/.test(value) ? value : normalizeGroup(value)

export async function userHidden(db: D1Database, userId: number): Promise<HiddenLesson[]> {
  const { results } = await db.prepare(`SELECT ${HIDDEN_COLUMNS} FROM hidden_lessons WHERE user_id = ? ORDER BY grp, weekday, start, id`)
    .bind(userId)
    .all<HiddenRow>()
  return results.map(hiddenFromRow)
}

// ---------- приложение: POST /hidden/add | /hidden/delete ----------

type Body = { group?: unknown; date?: unknown; start?: unknown; subject?: unknown; kind?: unknown; scope?: unknown; id?: unknown }

const fail = (status: number, error: string) => json({ ok: false, error }, status)

export async function handleHiddenApi(env: Env, request: Request, action: string): Promise<Response> {
  const req = await readApi<Body>(env, request, { write: true })
  if (req instanceof Response) return req
  const me = req.profile.id

  if (action === 'delete') {
    const id = typeof req.body.id === 'number' && Number.isSafeInteger(req.body.id) ? req.body.id : null
    if (id === null) return fail(400, 'bad request')
    await env.DB.prepare('DELETE FROM hidden_lessons WHERE id = ? AND user_id = ?').bind(id, me).run()
    forgetCalendarOf(me)
    return json({ ok: true, hidden: await userHidden(env.DB, me) })
  }
  if (action !== 'add') return fail(404, 'not found')

  const { body } = req
  const group = groupKey(body.group)
  const scope = SCOPES.find((s) => s === body.scope)
  const date = typeof body.date === 'string' && DATE.test(body.date) ? body.date : null
  const start = typeof body.start === 'string' && TIME.test(body.start) ? body.start : null
  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 200) : null
  const kind = typeof body.kind === 'string' ? body.kind.slice(0, 40) : null
  if (!group || !scope || !date || !start || !subject) return fail(400, 'bad request')

  // пара должна быть у группы в этот день (с правками, но без чужих скрытий)
  const tt = await loadTimetable(env, [group])
  if (!tt.schedule.groups.includes(group)) return fail(400, 'Нет такой группы')
  const day = dayFromIso(date)
  const lesson = dayLessons(tt, group, day, tt.extras).lessons.find(
    (l) => l.start === start && l.subject === subject && (l.kind ?? null) === kind,
  )
  if (!lesson) return fail(400, 'Такой пары в этот день нет — обнови расписание')
  // перенесённая сюда пара скрывается по исходной (день, время, дата)
  const from = lesson.movedFrom
  const key = from
    ? { weekday: tt.weekdayOf(dayFromIso(from.date)), start: from.start, date: from.date }
    : { weekday: tt.weekdayOf(day), start: lesson.start, date }

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM hidden_lessons WHERE user_id = ?').bind(me).first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_PER_USER) return fail(400, 'Слишком много скрытых пар — верни ненужные в «Профиле»')
  const row = await env.DB.prepare(
    `INSERT INTO hidden_lessons (user_id, grp, weekday, start, subject, kind, scope, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, grp, weekday, start, subject, kind, scope, date) DO UPDATE SET created_at = excluded.created_at
     RETURNING id`,
  )
    .bind(me, group, key.weekday, key.start, lesson.subject, lesson.kind ?? '', scope, scope === 'day' ? key.date : '', Date.now())
    .first<{ id: number }>()
  forgetCalendarOf(me)
  return json({ ok: true, id: row?.id ?? null, hidden: await userHidden(env.DB, me) })
}

// ---------- админ-панель ----------

export type HiddenWindow = {
  group: string
  weekday: number
  start: string
  subject: string
  kind: string | null
  scope: HideScope
  users: number // сколько людей скрыли
  members: number // сколько людей в группе
  share: number // users / members
  suggest: boolean // ≥ 60% и хотя бы двое — скорее всего, пара не их
  done: boolean // уже скрыта для всей группы
}

// Сводка: какие пары люди скрывают у себя (по группам) и что скрыто для всей группы
export async function hiddenOverview(env: Env): Promise<{ windows: HiddenWindow[]; group: HiddenLesson[]; people: number; rules: number }> {
  const [windows, total, group] = await env.DB.batch([
    env.DB.prepare(
      `SELECT grp, weekday, start, subject, kind, scope, COUNT(DISTINCT user_id) AS n FROM hidden_lessons
       WHERE user_id > 0 AND scope != 'day'
       GROUP BY grp, weekday, start, subject, kind, scope ORDER BY n DESC LIMIT 200`,
    ),
    env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS people, COUNT(*) AS rules FROM hidden_lessons WHERE user_id > 0`),
    env.DB.prepare(`SELECT ${HIDDEN_COLUMNS} FROM hidden_lessons WHERE user_id = 0 ORDER BY grp, weekday, start`),
  ])
  const rows = windows.results as (Omit<HiddenRow, 'id' | 'user_id' | 'date'> & { n: number })[]
  const groups = [...new Set(rows.map((r) => r.grp))]
  const members = new Map<string, number>()
  if (groups.length) {
    const { results } = await env.DB.prepare(
      'SELECT grp, COUNT(*) AS n FROM users WHERE grp IN (SELECT value FROM json_each(?)) GROUP BY grp',
    )
      .bind(JSON.stringify(groups))
      .all<{ grp: string; n: number }>()
    for (const r of results) members.set(r.grp, r.n)
  }
  const groupRules = (group.results as HiddenRow[]).map(hiddenFromRow)
  const same = (a: { grp?: string; group?: string; weekday: number; start: string; subject: string; kind: string | null }, h: HiddenLesson) =>
    (a.grp ?? a.group) === h.group && a.weekday === h.weekday && a.start === h.start && a.subject === h.subject && (a.kind || null) === h.kind
  const out = rows.map((r): HiddenWindow => {
    const size = Math.max(members.get(r.grp) ?? 0, r.n)
    const share = size ? r.n / size : 0
    return {
      group: r.grp,
      weekday: r.weekday,
      start: r.start,
      subject: r.subject,
      kind: r.kind || null,
      scope: r.scope,
      users: r.n,
      members: size,
      share,
      suggest: r.n >= SUGGEST_MIN && share >= SUGGEST_SHARE,
      done: groupRules.some((h) => same(r, h) && (h.scope === 'always' || h.scope === r.scope)),
    }
  })
  out.sort((a, b) => Number(b.suggest && !b.done) - Number(a.suggest && !a.done) || b.share - a.share || b.users - a.users)
  const stats = total.results[0] as { people: number; rules: number } | undefined
  return { windows: out, group: groupRules, people: stats?.people ?? 0, rules: stats?.rules ?? 0 }
}

// Скрыть пару для всей группы (по чётным / нечётным / всегда) — у всех, и в беседе группы
// (в журнал действий пишет admin-api.ts, как все действия владельца)
export async function hideForGroup(env: Env, body: Body & { weekday?: unknown }): Promise<string | null> {
  const group = groupKey(body.group)
  const scope = SCOPES.find((s) => s === body.scope && s !== 'day')
  const weekday = typeof body.weekday === 'number' && Number.isInteger(body.weekday) && body.weekday >= 0 && body.weekday <= 6 ? body.weekday : null
  const start = typeof body.start === 'string' && TIME.test(body.start) ? body.start : null
  const subject = typeof body.subject === 'string' ? body.subject : null
  const kind = typeof body.kind === 'string' && body.kind ? body.kind : null
  if (!group || !scope || weekday === null || !start || !subject) return 'bad request'
  const tt = await loadTimetable(env, [group])
  const exists = tt.schedule.lessons.some(
    (l) => l.group === group && l.weekday === weekday && l.start === start && l.subject === subject && (l.kind ?? null) === kind,
  )
  if (!exists) return 'Такой пары у группы нет'
  await env.DB.prepare(
    `INSERT OR IGNORE INTO hidden_lessons (user_id, grp, weekday, start, subject, kind, scope, date, created_at)
     VALUES (0, ?, ?, ?, ?, ?, ?, '', ?)`,
  )
    .bind(group, weekday, start, subject, kind ?? '', scope, Date.now())
    .run()
  invalidateExtras()
  return null
}

export async function unhideForGroup(env: Env, id: unknown): Promise<boolean> {
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return false
  const { meta } = await env.DB.prepare('DELETE FROM hidden_lessons WHERE id = ? AND user_id = 0').bind(id).run()
  invalidateExtras()
  return meta.changes > 0
}

// cron: «только в этот день» старше месяца уже не нужны
export async function cleanupHidden(env: Env, now: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM hidden_lessons WHERE scope = 'day' AND date < ?`)
    .bind(isoFromDay(Math.floor((now + 3 * 3_600_000) / 86_400_000) - 30))
    .run()
}
