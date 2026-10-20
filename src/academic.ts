// Учебный график группы (этап 8.3): типовой график + учёба по расписанию (data/calendar.json) + правки владельца
// (GET /academic у бота) + опубликованная сессия группы. Логика периодов — shared/calendar-core.ts.
import { periodsFor, type CalendarEdit, type ComputedCalendar, type Period } from '../shared/calendar-core'
import type { GroupInfo } from '../shared/groups'
import { cachedList, groupInfo, loadSession, loadSessionStatus } from './data'
import { readLocal, writeLocal } from './storage'
import { BOT_URL } from './telegram'

const loadComputed = cachedList<ComputedCalendar>('calendar.json', 'calendar_computed')

const EDITS_KEY = 'calendar_edits'
let fresh = false
let editsPromise: Promise<CalendarEdit[]> | null = null

async function fetchEdits(): Promise<CalendarEdit[]> {
  const saved = (() => {
    try {
      return JSON.parse(readLocal(EDITS_KEY) ?? '[]') as CalendarEdit[]
    } catch {
      return []
    }
  })()
  if (!BOT_URL) return saved
  try {
    // после правки в админке — мимо кэша браузера (ответ кэшируется на минуту)
    const res = await fetch(`${BOT_URL}/academic`, fresh ? { cache: 'no-store' } : {})
    fresh = false
    if (!res.ok) return saved
    const data = (await res.json()) as { edits: CalendarEdit[] }
    writeLocal(EDITS_KEY, JSON.stringify(data.edits))
    return data.edits
  } catch {
    return saved
  }
}

export const loadCalendarEdits = () => (editsPromise ??= fetchEdits())

// владелец поправил график в админке — перечитать
export function forgetCalendar() {
  editsPromise = null
  fresh = true
}

export const loadComputedCalendar = () => loadComputed().catch(() => null)

// Опубликованная сессия группы → период «Сессия» по документу ГУУ
async function publishedSession(group: string) {
  const status = await loadSessionStatus().catch(() => null)
  if (!status?.groups.includes(group)) return null
  const file = await loadSession(group).catch(() => null)
  const dates = (file?.items ?? []).flatMap((i) => [i.date, i.until ?? i.date]).sort()
  return dates.length && file ? { start: dates[0], end: dates[dates.length - 1], title: file.title } : null
}

export type GroupCalendar = { info: GroupInfo | null; periods: Period[]; typical: boolean }

// У преподавателя своей группы нет — типовой график 1 курса бакалавриата (отмечено на экране)
const TYPICAL: Pick<GroupInfo, 'level' | 'form' | 'course' | 'program'> = { level: 'bachelor', form: 'ofo', course: 1, program: '' }

export async function groupCalendar(group: string): Promise<GroupCalendar> {
  const info = group.startsWith('t-') ? null : await groupInfo(group).catch(() => null)
  const [computed, edits, session] = await Promise.all([
    loadComputedCalendar(),
    loadCalendarEdits(),
    info ? publishedSession(group) : Promise.resolve(null),
  ])
  return { info, periods: periodsFor(info ?? TYPICAL, computed, edits, session), typical: !info }
}
