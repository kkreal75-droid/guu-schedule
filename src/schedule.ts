import rawOverrides from '../overrides.json'
import { readLocal, writeLocal } from './storage'

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

type Weeks = number[] | string // [1, 2, 3] или "1-18", "3,5,7"

type Overrides = {
  remove?: { group: string; weekday: number; start: string; subject?: string; weeks?: Weeks }[]
  add?: (Omit<Lesson, 'weeks' | 'kind' | 'teacher' | 'room'> & {
    weeks: Weeks
    kind?: string | null
    teacher?: string | null
    room?: string | null
  })[]
}

function parseWeeks(spec: Weeks): number[] {
  if (Array.isArray(spec)) return spec
  const weeks = new Set<number>()
  for (const chunk of spec.split(/[,\s]+/)) {
    if (!chunk) continue
    const [a, b = a] = chunk.split(/[-–]/).map(Number)
    for (let w = a; w <= b; w++) weeks.add(w)
  }
  return [...weeks].filter((w) => Number.isInteger(w) && w >= 1).sort((x, y) => x - y)
}

function applyOverrides(lessons: Lesson[], overrides: Overrides): Lesson[] {
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

// Даты храним как номер дня от 1970-01-01 (UTC) — без часовых поясов и DST.
export const DAY_MS = 86_400_000

// ---------- загрузка ----------
// schedule.json лежит рядом с сайтом и скачивается при каждом запуске мимо кэша:
// ?v=<время> — чтобы ни браузер, ни CDN GitHub Pages не отдали старую копию.
// Последняя удачная копия сохраняется: без сети покажем её.

const CACHE_KEY = 'schedule_cache'

// заполняются в loadSchedule() до первой отрисовки приложения (см. main.tsx)
export let schedule: Schedule
export let START_DAY = 0
export let MAX_WEEK = 1
export let fromCache = false
let SLOT_STARTS: string[] = []

async function fetchSchedule(): Promise<Schedule> {
  const url = new URL('schedule.json', document.baseURI)
  url.searchParams.set('v', String(Date.now()))
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`schedule.json: HTTP ${res.status}`)
  return (await res.json()) as Schedule
}

export async function loadSchedule(): Promise<void> {
  let data: Schedule
  try {
    data = await fetchSchedule()
    writeLocal(CACHE_KEY, JSON.stringify(data))
  } catch (err) {
    const cached = readLocal(CACHE_KEY)
    if (!cached) throw err
    console.warn('Не удалось скачать schedule.json — показываю сохранённую копию', err)
    data = JSON.parse(cached) as Schedule
    fromCache = true
  }

  schedule = { ...data, lessons: applyOverrides(data.lessons, rawOverrides as Overrides) }
  const [sy, sm, sd] = schedule.semester_start.split('-').map(Number)
  START_DAY = Date.UTC(sy, sm - 1, sd) / DAY_MS
  MAX_WEEK = Math.max(...schedule.lessons.flatMap((l) => l.weeks))
  SLOT_STARTS = [...new Set(schedule.lessons.map((l) => l.start))].sort()
}

export const weekOf = (day: number) => Math.floor((day - START_DAY) / 7) + 1
export const weekdayOf = (day: number) => (((day - START_DAY) % 7) + 7) % 7
export const dayOf = (week: number, weekday: number) => START_DAY + (week - 1) * 7 + weekday
export const inSemester = (week: number) => week >= 1 && week <= MAX_WEEK
export const isEvenWeek = (week: number) => week % 2 === 0

export const pairNumber = (start: string) => SLOT_STARTS.indexOf(start) + 1

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function lessonsOn(group: string, week: number, weekday: number): Lesson[] {
  return schedule.lessons
    .filter((l) => l.group === group && l.weekday === weekday && l.weeks.includes(week))
    .sort((a, b) => a.start.localeCompare(b.start))
}

// Текущие дата и время в Москве — расписание ГУУ живёт по московскому времени,
// даже если телефон в другом поясе.
export function moscowNow(): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    day: Date.UTC(get('year'), get('month') - 1, get('day')) / DAY_MS,
    minutes: get('hour') * 60 + get('minute'),
  }
}
