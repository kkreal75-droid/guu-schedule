// Учебный график группы (этап 8.3): типовой график + учёба по расписанию (data/calendar.json) + правки владельца
// (GET /academic у бота) + опубликованная сессия группы. Логика периодов — shared/calendar-core.ts.
import { periodsFor, type CalendarEdit, type ComputedCalendar, type Period, type PeriodKind, type PeriodSource } from '../shared/calendar-core'
import { dayFromIso } from '../shared/schedule-core'
import type { GroupInfo } from '../shared/groups'
import { cachedList, groupInfo, loadSession, loadSessionStatus } from './data'
import { formatDate } from './format'
import { t, tKnown } from './i18n'
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

// ---------- на языке интерфейса (этап 11) ----------
// названия периодов из типового графика и праздников — по словарю; свои названия владельца — как есть

export const kindTitle = (kind: PeriodKind) =>
  ({ study: t('Учёба'), session: t('Сессия'), practice: t('Практика#период'), holidays: t('Каникулы') })[kind]

export const sourceTitle = (source: PeriodSource) =>
  ({ doc: t('по документу ГУУ'), schedule: t('по расписанию (уточняется)'), estimate: t('по типовому графику ГУУ (уточняется)') })[source]

export const periodTitle = (p: Pick<Period, 'title' | 'kind'>) => (p.title ? (tKnown(p.title) ?? p.title) : kindTitle(p.kind))
export const holidayTitle = (title: string) => tKnown(title) ?? title

// «7 февраля» / «7 February»
export const isoLong = (iso: string) => formatDate(dayFromIso(iso))
