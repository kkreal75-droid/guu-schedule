// Логика расписания, общая для мини-приложения (src/) и бота (bot/):
// файлы групп data/schedule/<id>.json, ручные правки overrides.json и overrides/*.json,
// учебные недели, пары на день.
import { normalizeGroup } from './groups'

// Пара. group — id группы («b1-mb-mp-1»); в старом schedule.json — имя («МБ(МП) 1-1»).
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
  teachers?: string[] // в ячейке несколько преподавателей (teacher — первый из них)
  pair?: number | null // номер пары, если известен заранее (в расписании преподавателя)
}

export type Schedule = {
  updated_at?: string // когда update.py нашёл изменение, ISO по Москве
  source_file?: string // имя файла ГУУ
  source_sha256?: string
  semester_start: string // понедельник 1-й недели, YYYY-MM-DD
  groups: string[]
  lessons: Lesson[]
  names?: Record<string, string> // id группы → имя
  grids?: Record<string, Grid> // id группы → сетка пар по дням (из файла ГУУ)
}

// Сетка времени по дням недели: «0» → ["09:00-10:30", "10:40-12:10", …]
export type Grid = Record<string, string[]>

// Файл группы data/schedule/<id>.json — его пишет update.py
export type GroupFile = {
  id: string
  name: string
  updated_at: string
  semester_start: string
  source_file?: string | null
  grid: Grid
  lessons: Omit<Lesson, 'group'>[]
}

// Файл преподавателя data/teachers/<id>.json: одна пара потока — одной строкой со списком групп
export type TeacherFile = {
  id: string
  name: string
  semester_start: string
  lessons: (Omit<Lesson, 'group' | 'teacher' | 'teachers'> & { groups: string[]; group_names: string[] })[]
  past_groups?: string[] // у каких групп вёл пары в прошлом семестре (отзывы о преподавателе)
}

export const teacherKey = (id: string) => `t-${id}` // «группа» в расписании преподавателя

// Расписание преподавателя как расписание одной «группы»: вместо преподавателя у пары — группы
export function teacherAsGroup(file: TeacherFile): GroupFile {
  return {
    id: teacherKey(file.id),
    name: file.name,
    updated_at: '',
    semester_start: file.semester_start,
    grid: {},
    lessons: file.lessons.map(({ groups: _, group_names, ...l }) => ({ ...l, teacher: group_names.join(', ') })),
  }
}

// Несколько файлов групп → одно расписание
export function scheduleFromGroups(files: GroupFile[]): Schedule {
  const updated = files.map((f) => f.updated_at).sort().at(-1)
  return {
    updated_at: updated,
    source_file: files[0]?.source_file ?? undefined,
    semester_start: files[0]?.semester_start ?? '2026-08-31',
    groups: files.map((f) => f.id),
    lessons: files.flatMap((f) => f.lessons.map((l) => ({ ...l, group: f.id }))),
    names: Object.fromEntries(files.map((f) => [f.id, f.name])),
    grids: Object.fromEntries(files.map((f) => [f.id, f.grid])),
  }
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

// В файлах правок группа может быть записана именем («МБ(МП) 1-1») — приводим к id;
// правки для групп, которых сейчас нет в расписании, пропускаем
function forGroups<T extends { group: string }>(rules: T[] | undefined, groups: Set<string>): T[] {
  return (rules ?? [])
    .map((r) => ({ ...r, group: groups.has(r.group) ? r.group : (normalizeGroup(r.group) ?? r.group) }))
    .filter((r) => groups.has(r.group))
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
  pairNumber(lesson: Pick<Lesson, 'group' | 'weekday' | 'start' | 'pair'>): number
  nameOf(group: string): string // id → «МБ(МП) 1-1»
  lessonsOn(group: string, week: number, weekday: number): Lesson[]
}

export function makeTimetable(data: Schedule, overrides: Overrides, replacements: DayReplacement[] = []): Timetable {
  const groups = new Set(data.groups)
  const own: Overrides = { remove: forGroups(overrides.remove, groups), add: forGroups(overrides.add, groups) }
  const schedule = {
    ...data,
    lessons: applyReplacements(applyOverrides(data.lessons, own), forGroups(replacements, groups)),
  }
  const startDay = dayFromIso(schedule.semester_start)
  // не меньше 18 недель (так в файлах ГУУ); reduce, а не Math.max(...): пар бывает много
  const maxWeek = schedule.lessons.reduce((max, l) => l.weeks.reduce((m, w) => (w > m ? w : m), max), 18)
  const slotStarts = [...new Set(schedule.lessons.map((l) => l.start))].sort()
  // номер пары — по сетке группы на этот день (у вечерних групп 18:50 — это 1-я пара);
  // нет сетки — по порядку времени начала
  const pairNumber = (lesson: Pick<Lesson, 'group' | 'weekday' | 'start' | 'pair'>) => {
    if (lesson.pair) return lesson.pair
    const day = schedule.grids?.[lesson.group]?.[String(lesson.weekday)]
    const i = day ? day.findIndex((slot) => slot.startsWith(lesson.start)) : -1
    return i >= 0 ? i + 1 : slotStarts.indexOf(lesson.start) + 1
  }
  return {
    schedule,
    startDay,
    maxWeek,
    weekOf: (day) => Math.floor((day - startDay) / 7) + 1,
    weekdayOf: (day) => (((day - startDay) % 7) + 7) % 7,
    dayOf: (week, weekday) => startDay + (week - 1) * 7 + weekday,
    inSemester: (week) => week >= 1 && week <= maxWeek,
    pairNumber,
    nameOf: (group) => schedule.names?.[group] ?? group,
    lessonsOn: (group, week, weekday) =>
      schedule.lessons
        .filter((l) => l.group === group && l.weekday === weekday && l.weeks.includes(week))
        .sort((a, b) => a.start.localeCompare(b.start)),
  }
}
