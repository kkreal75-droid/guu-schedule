import rawOverrides from '../overrides.json'
import { makeTimetable, type Lesson, type Overrides, type Schedule, type Timetable } from '../shared/schedule-core'
import { readLocal, writeLocal } from './storage'

// Логика недель и правок — общая с ботом, в shared/schedule-core.ts
export { DAY_MS, moscowNow, toMinutes } from '../shared/schedule-core'
export { isEvenWeek } from '../shared/format-core'
export type { Lesson, Schedule } from '../shared/schedule-core'

// ---------- загрузка ----------
// schedule.json лежит рядом с сайтом и скачивается при каждом запуске мимо кэша:
// ?v=<время> — чтобы ни браузер, ни CDN GitHub Pages не отдали старую копию.
// Последняя удачная копия сохраняется: без сети покажем её.

const CACHE_KEY = 'schedule_cache'

// заполняются в loadSchedule() до первой отрисовки приложения (см. main.tsx)
let timetable: Timetable
export let schedule: Schedule
export let START_DAY = 0
export let MAX_WEEK = 1
export let fromCache = false

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

  timetable = makeTimetable(data, rawOverrides as Overrides)
  schedule = timetable.schedule
  START_DAY = timetable.startDay
  MAX_WEEK = timetable.maxWeek
}

export const weekOf = (day: number) => timetable.weekOf(day)
export const weekdayOf = (day: number) => timetable.weekdayOf(day)
export const dayOf = (week: number, weekday: number) => timetable.dayOf(week, weekday)
export const inSemester = (week: number) => timetable.inSemester(week)
export const pairNumber = (start: string) => timetable.pairNumber(start)

export function lessonsOn(group: string, week: number, weekday: number): Lesson[] {
  return timetable.lessonsOn(group, week, weekday)
}
