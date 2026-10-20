// Календарный учебный график (этап 8.3): правки владельца (D1 calendar_edits) поверх типового графика
// (shared/calendar-core.ts) и учёбы по расписанию (data/calendar.json).
//   GET /academic — правки всем (данные публичные), кэш 60 с;
//   POST /admin/academic* — только OWNER_ID (проверку делает handleAdminApi);
//   утренняя сводка в беседу в первый день каникул — «🎉 Каникулы! Пар нет до ДД.ММ» (digest.ts).
import {
  formatIsoShort, holidaysStartingOn, parseScope, periodsFor, periodsProblem, type CalendarEdit, type PeriodDraft,
  type PeriodKind,
} from '../../shared/calendar-core'
import { isoFromDay } from '../../shared/schedule-core'
import { CORS, json } from './api'
import { loadComputedCalendar, loadGroupsIndex } from './schedule'

const KINDS: PeriodKind[] = ['study', 'session', 'practice', 'holidays']
const fail = (error: string) => json({ ok: false, error }, 400)
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

export async function loadCalendarEdits(env: Env): Promise<CalendarEdit[]> {
  const { results } = await env.DB.prepare('SELECT scope, periods, doc, updated_at FROM calendar_edits ORDER BY scope').all<{
    scope: string
    periods: string
    doc: number
    updated_at: number
  }>()
  return results.map((r) => ({ scope: r.scope, periods: JSON.parse(r.periods) as PeriodDraft[], doc: r.doc === 1, updated_at: r.updated_at }))
}

export async function handleAcademicGet(env: Env): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, edits: await loadCalendarEdits(env) }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  })
}

// {scope, periods: [{kind, start, end, title}], doc}
export async function academicSave(env: Env, body: Record<string, unknown>): Promise<Response> {
  const scope = clip(body.scope, 300)
  if (!parseScope(scope)) return fail('bad request')
  const raw = Array.isArray(body.periods) ? (body.periods as Record<string, unknown>[]) : []
  const periods: PeriodDraft[] = raw.map((p) => ({
    kind: (KINDS.includes(p.kind as PeriodKind) ? p.kind : 'study') as PeriodKind,
    start: clip(p.start, 10),
    end: clip(p.end, 10),
    title: clip(p.title, 60),
  }))
  const problem = periodsProblem(periods)
  if (problem) return fail(problem)
  periods.sort((a, b) => a.start.localeCompare(b.start))
  await env.DB.prepare(
    `INSERT INTO calendar_edits (scope, periods, doc, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (scope) DO UPDATE SET periods = ?2, doc = ?3, updated_at = ?4`,
  )
    .bind(scope, JSON.stringify(periods), body.doc === true ? 1 : 0, Date.now())
    .run()
  return json({ ok: true, edits: await loadCalendarEdits(env) })
}

// вернуть типовой график
export async function academicReset(env: Env, body: Record<string, unknown>): Promise<Response> {
  const scope = clip(body.scope, 300)
  if (!parseScope(scope)) return fail('bad request')
  await env.DB.prepare('DELETE FROM calendar_edits WHERE scope = ?').bind(scope).run()
  return json({ ok: true, edits: await loadCalendarEdits(env) })
}

// Группы, у которых сегодня первый день каникул → текст для утренней сводки (3 подзапроса на всех)
export async function holidayTexts(env: Env, groups: string[], day: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!groups.length) return out
  const [index, computed, edits] = await Promise.all([loadGroupsIndex(env), loadComputedCalendar(env), loadCalendarEdits(env)])
  const today = isoFromDay(day)
  for (const id of groups) {
    const g = index.groups.find((x) => x.id === id)
    if (!g) continue
    const holidays = holidaysStartingOn(periodsFor(g, computed, edits), today)
    if (holidays) out.set(id, `🎉 Каникулы! Пар нет до ${formatIsoShort(holidays.end)}`)
  }
  return out
}
