// Календарный учебный график (этап 8.3) — общий для мини-приложения и бота.
// Официальные графики ГУУ (guu.ru → Сведения → Образование) — PDF на программу: в одних одна сетка без номера
// курса, в других четыре курса на шаблонном годе, недели слиты в ячейки — надёжно их не разобрать. Поэтому график
// собираем сами:
//   • учёба осеннего семестра — по файлам расписания (data/calendar.json, update.py) — «по расписанию»;
//   • сессия — по файлам сессии, если ГУУ уже опубликовал её для группы — «по документу ГУУ»;
//   • остальное — типовой график по уровню, форме и курсу (даты 2026/27 — из официального КУГ ГУУ на 2026/27:
//     зимняя сессия 9–29 января, каникулы 30 января – 7 февраля, летняя сессия с 16 июня…) — «уточняется»;
//   • владелец правит периоды в «Админ-панель → Учебный график» (D1 calendar_edits; отметка «сверено с
//     документом ГУУ» — источник «по документу ГУУ»).
// Праздничные нерабочие дни РФ — отдельной категорией.
import type { Form, GroupInfo, Level } from './groups'
import { dayFromIso, isoFromDay } from './schedule-core'

export type PeriodKind = 'study' | 'session' | 'practice' | 'holidays'
export type PeriodSource = 'doc' | 'schedule' | 'estimate'
export type PeriodDraft = { kind: PeriodKind; start: string; end: string; title: string } // ГГГГ-ММ-ДД, включительно
export type Period = PeriodDraft & { source: PeriodSource }

export const KIND_TITLES: Record<PeriodKind, string> = {
  study: 'Учёба',
  session: 'Сессия',
  practice: 'Практика',
  holidays: 'Каникулы',
}
export const SOURCE_TITLES: Record<PeriodSource, string> = {
  doc: 'по документу ГУУ',
  schedule: 'по расписанию (уточняется)',
  estimate: 'по типовому графику ГУУ (уточняется)',
}

export const YEAR = { title: '2026/27', start: '2026-09-01', end: '2027-08-31' }

// Нерабочие праздничные дни 2026/27: ТК РФ ст. 112, постановления Правительства от 24.09.2025 № 1466
// (31.12.2026 — за 4 января) и от 17.09.2026 № 1187 (22.02.2027 — за 20 февраля). Праздник в выходной —
// выходной переносится на следующий рабочий день (ст. 112), кроме 1–8 января.
export type Holiday = { date: string; title: string }
export const HOLIDAYS: Holiday[] = [
  { date: '2026-11-04', title: 'День народного единства' },
  { date: '2026-12-31', title: 'Выходной (перенос с 4 января)' },
  ...['01', '02', '03', '04', '05', '06', '08'].map((d) => ({ date: `2027-01-${d}`, title: 'Новогодние каникулы' })),
  { date: '2027-01-07', title: 'Рождество Христово' },
  { date: '2027-02-22', title: 'Выходной (перенос с 20 февраля)' },
  { date: '2027-02-23', title: 'День защитника Отечества' },
  { date: '2027-03-08', title: 'Международный женский день' },
  { date: '2027-05-01', title: 'Праздник Весны и Труда' },
  { date: '2027-05-03', title: 'Выходной (перенос с 1 мая)' },
  { date: '2027-05-09', title: 'День Победы' },
  { date: '2027-05-10', title: 'Выходной (перенос с 9 мая)' },
  { date: '2027-06-12', title: 'День России' },
  { date: '2027-06-14', title: 'Выходной (перенос с 12 июня)' },
].sort((a, b) => a.date.localeCompare(b.date))
const HOLIDAY_DATES = new Set(HOLIDAYS.map((h) => h.date))
export const holidayOn = (iso: string) => HOLIDAYS.find((h) => h.date === iso) ?? null

// data/calendar.json (update.py): первая и последняя пара курса по файлам расписания
export type ComputedCalendar = {
  year: string
  semester_start: string
  study: Record<string, { first: string; last: string; groups: number }> // «bachelor|ofo|1»
}

// Правка владельца: периоды на уровень/форму/курс (и, если нужно, на одну программу)
export type CalendarEdit = { scope: string; periods: PeriodDraft[]; doc: boolean; updated_at: number }

export const scopeKey = (level: Level, form: Form, course: number, program?: string | null) =>
  [level, form, String(course), ...(program ? [program] : [])].join('|')

export function parseScope(scope: string): { level: Level; form: Form; course: number; program: string | null } | null {
  const [level, form, course, ...rest] = scope.split('|')
  if (!['bachelor', 'master', 'postgrad'].includes(level) || !['ofo', 'ozfo'].includes(form)) return null
  const n = Number(course)
  if (!Number.isInteger(n) || n < 1 || n > 6) return null
  return { level: level as Level, form: form as Form, course: n, program: rest.join('|') || null }
}

const addDays = (iso: string, n: number) => isoFromDay(dayFromIso(iso) + n)
const weekday = (iso: string) => (((dayFromIso(iso) - 4) % 7) + 7) % 7 // 0 — понедельник

// последний учебный день не позже iso: без праздников и воскресений
function lastWorkday(iso: string): string {
  let d = iso
  while (HOLIDAY_DATES.has(d) || weekday(d) === 6) d = addDays(d, -1)
  return d
}

// ---------- типовой график 2026/27 ----------

const WINTER_SESSION = { start: '2027-01-09', end: '2027-01-29' }
const WINTER_HOLIDAYS = { start: '2027-01-30', end: '2027-02-07' }
const SPRING_START = '2027-02-08'

type Shape = 'regular' | 'practice-study' | 'practice-work' | 'final'

// какой «рисунок» у весны: 2 курс — учебная практика, 3 — производственная, выпускной — ГИА
function shapeOf(level: Level, form: Form, course: number): Shape {
  if (level === 'postgrad') return 'regular'
  if (level === 'master') return course >= 2 ? 'final' : 'regular'
  const last = form === 'ozfo' ? 5 : 4
  if (course >= last) return 'final'
  if (form === 'ofo' && course === 2) return 'practice-study'
  if (form === 'ofo' && course === 3) return 'practice-work'
  return 'regular'
}

function spring(shape: Shape): PeriodDraft[] {
  const p = (kind: PeriodKind, start: string, end: string, title: string): PeriodDraft => ({ kind, start, end, title })
  switch (shape) {
    case 'final':
      return [
        p('study', SPRING_START, '2027-04-11', 'Весенний семестр'),
        p('session', '2027-04-12', '2027-05-01', 'Весенняя сессия'),
        p('practice', '2027-05-04', '2027-05-30', 'Преддипломная практика'),
        p('session', '2027-05-31', '2027-07-04', 'ГИА: госэкзамен и защита ВКР'),
        p('holidays', '2027-07-05', YEAR.end, 'Каникулы после ГИА'),
      ]
    case 'practice-work':
      return [
        p('study', SPRING_START, '2027-05-08', 'Весенний семестр'),
        p('practice', '2027-05-11', '2027-06-13', 'Производственная практика'),
        p('session', '2027-06-15', '2027-07-04', 'Летняя сессия'),
        p('holidays', '2027-07-05', YEAR.end, 'Летние каникулы'),
      ]
    case 'practice-study':
      return [
        p('study', SPRING_START, '2027-05-31', 'Весенний семестр'),
        p('practice', '2027-06-01', '2027-06-15', 'Учебная практика'),
        p('session', '2027-06-16', '2027-07-05', 'Летняя сессия'),
        p('holidays', '2027-07-06', YEAR.end, 'Летние каникулы'),
      ]
    default:
      return [
        p('study', SPRING_START, '2027-06-15', 'Весенний семестр'),
        p('session', '2027-06-16', '2027-07-05', 'Летняя сессия'),
        p('holidays', '2027-07-06', YEAR.end, 'Летние каникулы'),
      ]
  }
}

// Типовой график курса; осенняя учёба — по расписанию, если оно есть
export function defaultPeriods(level: Level, form: Form, course: number, computed?: ComputedCalendar | null): Period[] {
  const span = computed?.study[`${level}|${form}|${course}`]
  const first = span ? span.first : YEAR.start
  const last = lastWorkday(span && span.last < WINTER_SESSION.start ? span.last : addDays(WINTER_SESSION.start, -1))
  const est = (d: PeriodDraft): Period => ({ ...d, source: 'estimate' })
  return [
    { kind: 'study', start: first, end: last, title: 'Осенний семестр', source: span ? 'schedule' : 'estimate' },
    est({ kind: 'session', ...WINTER_SESSION, title: 'Зимняя сессия' }),
    est({ kind: 'holidays', ...WINTER_HOLIDAYS, title: 'Зимние каникулы' }),
    ...spring(shapeOf(level, form, course)).map(est),
  ]
}

type GroupScope = Pick<GroupInfo, 'level' | 'form' | 'course' | 'program'>

// Периоды группы: правка владельца (своя программа → курс) или типовой график; опубликованная сессия группы
// (data/session/<id>.json) заменяет типовую сессию того же полугодия
export function periodsFor(
  g: GroupScope,
  computed: ComputedCalendar | null,
  edits: CalendarEdit[],
  session?: { start: string; end: string; title: string } | null,
): Period[] {
  const edit =
    edits.find((e) => e.scope === scopeKey(g.level, g.form, g.course, g.program)) ??
    edits.find((e) => e.scope === scopeKey(g.level, g.form, g.course))
  let periods: Period[] = edit
    ? edit.periods.map((p) => ({ ...p, source: edit.doc ? 'doc' : 'estimate' }))
    : defaultPeriods(g.level, g.form, g.course, computed)
  if (session) {
    const half = (iso: string) => (iso < SPRING_START ? 'autumn' : 'spring')
    const i = periods.findIndex((p) => p.kind === 'session' && half(p.start) === half(session.start))
    const exact: Period = { kind: 'session', start: session.start, end: session.end, title: session.title, source: 'doc' }
    // соседние периоды подвигаем: учёба кончается накануне сессии, каникулы начинаются после неё
    periods = periods
      .filter((_, j) => j !== i)
      .map((p) =>
        p.end < exact.start || p.start > exact.end
          ? p
          : p.start < exact.start
            ? { ...p, end: addDays(exact.start, -1) }
            : { ...p, start: addDays(exact.end, 1) },
      )
      .filter((p) => p.start <= p.end)
    periods.push(exact)
  }
  return periods.sort((a, b) => a.start.localeCompare(b.start))
}

// ---------- что в этот день ----------

export type DayInfo = { iso: string; period: Period | null; holiday: Holiday | null; sunday: boolean }

export function dayInfo(periods: Period[], iso: string): DayInfo {
  return {
    iso,
    period: periods.find((p) => p.start <= iso && iso <= p.end) ?? null,
    holiday: holidayOn(iso),
    sunday: weekday(iso) === 6,
  }
}

const daysBetween = (from: string, to: string) => dayFromIso(to) - dayFromIso(from)

// «Сейчас: учёба · до сессии N дней · до каникул M дней»
export type Summary = {
  current: Period | null
  nextSession: { period: Period; days: number } | null
  nextHolidays: { period: Period; days: number } | null
}

export function summary(periods: Period[], today: string): Summary {
  const current = periods.find((p) => p.start <= today && today <= p.end) ?? null
  const next = (kind: PeriodKind) => {
    const period = periods.find((p) => p.kind === kind && p.start > today)
    return period ? { period, days: daysBetween(today, period.start) } : null
  }
  return { current, nextSession: next('session'), nextHolidays: next('holidays') }
}

// Первый день каникул (или понедельник после каникул, начавшихся в воскресенье) — для сводки в беседу
export function holidaysStartingOn(periods: Period[], today: string): Period | null {
  return (
    periods.find(
      (p) => p.kind === 'holidays' && (p.start === today || (weekday(today) === 0 && p.start === addDays(today, -1))),
    ) ?? null
  )
}

// «7 февраля»
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const formatIsoLong = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`
export const formatIsoShort = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

// склонение «день / дня / дней»
export function daysWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

// Проверка периодов из админки: даты, порядок, тип; текст ошибки — для человека
export function periodsProblem(periods: PeriodDraft[]): string | null {
  if (!periods.length) return 'Добавьте хотя бы один период'
  if (periods.length > 20) return 'Слишком много периодов (до 20)'
  const iso = /^\d{4}-\d{2}-\d{2}$/
  for (const p of periods) {
    if (!(p.kind in KIND_TITLES)) return 'Неизвестный тип периода'
    if (!iso.test(p.start) || !iso.test(p.end) || Number.isNaN(dayFromIso(p.start)) || Number.isNaN(dayFromIso(p.end))) return 'Проверьте даты'
    if (p.start > p.end) return `«${p.title || KIND_TITLES[p.kind]}»: начало позже конца`
    if (p.start < '2026-08-01' || p.end > '2027-09-30') return `«${p.title || KIND_TITLES[p.kind]}»: даты вне учебного года 2026/27`
  }
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) return `«${sorted[i - 1].title}» и «${sorted[i].title}» пересекаются`
  }
  return null
}
