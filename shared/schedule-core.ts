// Логика расписания, общая для мини-приложения (src/) и бота (bot/):
// формат schedule.json, ручные правки overrides.json и overrides/*.json, учебные недели, пары на день.

// Формат schedule.json — см. parser.py и update.py
export type Lesson = {
  group: string
  weekday: number // 0 = понедельник
  start: string // "09:00"
  end: string
  subject: string
  kind: string | null // "Лекция" / "Практика" / "Лабораторная" / null
  weeks: number[]
  teacher: string | null
  room: string | null
}

export type Schedule = {
  updated_at?: string // когда update.py нашёл изменение, ISO по Москве
  source_file?: string // имя файла ГУУ
  source_sha256?: string
  semester_start: string // понедельник 1-й недели, YYYY-MM-DD
  groups: string[]
  lessons: Lesson[]
}

// ---------- ручные правки (overrides.json) ----------
// Нужны для того, чего нет в официальном файле ГУУ (например, языки из чата группы).
// schedule.json остаётся чистым выводом parser.py, правки накладываются здесь.

export type Weeks = number[] | string // [1, 2, 3] или "1-18", "3,5,7"

export type Overrides = {
  remove?: { group: string; weekday: number; start: string; subject?: string; weeks?: Weeks }[]
  add?: (Omit<Lesson, 'weeks' | 'kind' | 'teacher' | 'room'> & {
    weeks: Weeks
    kind?: string | null
    teacher?: string | null
    room?: string | null
  })[]
}

export function parseWeeks(spec: Weeks): number[] {
  if (Array.isArray(spec)) return spec
  const weeks = new Set<number>()
  for (const chunk of spec.split(/[,\s]+/)) {
    if (!chunk) continue
    const [a, b = a] = chunk.split(/[-–]/).map(Number)
    for (let w = a; w <= b; w++) weeks.add(w)
  }
  return [...weeks].filter((w) => Number.isInteger(w) && w >= 1).sort((x, y) => x - y)
}

export function applyOverrides(lessons: Lesson[], overrides: Overrides): Lesson[] {
  let out = lessons
  for (const r of overrides.remove ?? []) {
    const dropWeeks = r.weeks ? new Set(parseWeeks(r.weeks)) : null
    let matched = false
    out = out.flatMap((l) => {
      const hit =
        l.group === r.group && l.weekday === r.weekday && l.start === r.start && (!r.subject || l.subject === r.subject)
      if (!hit) return [l]
      matched = true
      const weeks = dropWeeks ? l.weeks.filter((w) => !dropWeeks.has(w)) : []
      return weeks.length ? [{ ...l, weeks }] : []
    })
    // файл ГУУ поменялся и правка больше ни к чему не относится — стоит пересмотреть overrides.json
    if (!matched) console.warn('overrides.json: remove не нашёл пару', r)
  }
  const added = (overrides.add ?? []).map((a) => ({
    ...a,
    weeks: parseWeeks(a.weeks),
    kind: a.kind ?? null,
    teacher: a.teacher ?? null,
    room: a.room ?? null,
  }))
  return [...out, ...added]
}

// ---------- замена дня целиком (overrides/thursday.json и т. п.) ----------
// Все пары группы в этот день недели (данные ГУУ и overrides.json) убираются и заменяются
// своим расписанием: even — на чётные недели, odd — на нечётные (неделя % 2, как в isEvenWeek).

type ReplacementLesson = Omit<Lesson, 'group' | 'weekday' | 'weeks' | 'kind' | 'teacher' | 'room'> & {
  kind?: string | null
  teacher?: string | null
  room?: string | null
}

export type DayReplacement = {
  group: string
  weekday: number
  kind?: string | null // тип пар по умолчанию
  weeks?: Weeks // на какие недели действует; нет — весь семестр
  even: ReplacementLesson[]
  odd: ReplacementLesson[]
}

export function applyReplacements(lessons: Lesson[], replacements: DayReplacement[]): Lesson[] {
  const semesterWeeks = [...new Set(lessons.flatMap((l) => l.weeks))].sort((a, b) => a - b)
  const lastWeek = semesterWeeks.at(-1) ?? 0
  let out = lessons
  for (const r of replacements) {
    const weeks = r.weeks ? parseWeeks(r.weeks) : Array.from({ length: lastWeek }, (_, i) => i + 1)
    const covered = new Set(weeks)
    out = out.flatMap((l) => {
      if (l.group !== r.group || l.weekday !== r.weekday) return [l]
      const rest = l.weeks.filter((w) => !covered.has(w))
      return rest.length ? [{ ...l, weeks: rest }] : []
    })
    const make = (list: ReplacementLesson[], parity: 0 | 1): Lesson[] =>
      list.map((l) => ({
        group: r.group,
        weekday: r.weekday,
        start: l.start,
        end: l.end,
        subject: l.subject,
        kind: l.kind ?? r.kind ?? null,
        teacher: l.teacher ?? null,
        room: l.room ?? null,
        weeks: weeks.filter((w) => w % 2 === parity),
      }))
    out = [...out, ...make(r.even, 0), ...make(r.odd, 1)]
  }
  return out
}

// ---------- даты ----------
// Даты храним как номер дня от 1970-01-01 (UTC) — без часовых поясов и DST.

export const DAY_MS = 86_400_000

export function dayFromIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

export function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Текущие дата и время в Москве — расписание ГУУ живёт по московскому времени,
// даже если телефон или сервер в другом поясе.
export function moscowNow(at: Date = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    day: Date.UTC(get('year'), get('month') - 1, get('day')) / DAY_MS,
    minutes: get('hour') * 60 + get('minute'),
  }
}

// ---------- учебные недели ----------

export type Timetable = {
  schedule: Schedule // с наложенными overrides.json и заменами дней
  startDay: number // понедельник 1-й недели
  maxWeek: number
  weekOf(day: number): number
  weekdayOf(day: number): number // 0 = понедельник
  dayOf(week: number, weekday: number): number
  inSemester(week: number): boolean
  pairNumber(start: string): number
  lessonsOn(group: string, week: number, weekday: number): Lesson[]
}

export function makeTimetable(data: Schedule, overrides: Overrides, replacements: DayReplacement[] = []): Timetable {
  const schedule = { ...data, lessons: applyReplacements(applyOverrides(data.lessons, overrides), replacements) }
  const startDay = dayFromIso(schedule.semester_start)
  const maxWeek = Math.max(...schedule.lessons.flatMap((l) => l.weeks))
  const slotStarts = [...new Set(schedule.lessons.map((l) => l.start))].sort()
  return {
    schedule,
    startDay,
    maxWeek,
    weekOf: (day) => Math.floor((day - startDay) / 7) + 1,
    weekdayOf: (day) => (((day - startDay) % 7) + 7) % 7,
    dayOf: (week, weekday) => startDay + (week - 1) * 7 + weekday,
    inSemester: (week) => week >= 1 && week <= maxWeek,
    pairNumber: (start) => slotStarts.indexOf(start) + 1,
    lessonsOn: (group, week, weekday) =>
      schedule.lessons
        .filter((l) => l.group === group && l.weekday === weekday && l.weeks.includes(week))
        .sort((a, b) => a.start.localeCompare(b.start)),
  }
}
