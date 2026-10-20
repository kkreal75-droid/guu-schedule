import rawOverrides from '../overrides.json'
import thursday from '../overrides/thursday.json'
import thursday12 from '../overrides/thursday-1-2.json'
import { MB_IDS, normalizeGroup } from '../shared/groups'
import {
  makeTimetable,
  scheduleFromGroups,
  type DayReplacement,
  type GroupFile,
  type Lesson,
  type Overrides,
  type Schedule,
  type Timetable,
} from '../shared/schedule-core'
import { readLocal, writeLocal } from './storage'

// Логика недель и правок — общая с ботом, в shared/schedule-core.ts
export { DAY_MS, dayFromIso, isoFromDay, moscowNow, toMinutes } from '../shared/schedule-core'
export { isEvenWeek } from '../shared/format-core'
export type { Lesson, Schedule } from '../shared/schedule-core'

// ---------- загрузка ----------
// Пары каждой группы — в data/schedule/<id>.json рядом с сайтом (их пишет update.py).
// Скачиваем при каждом запуске мимо кэша: ?v=<время> — чтобы ни браузер, ни CDN GitHub Pages
// не отдали старую копию. Последняя удачная копия группы сохраняется: без сети покажем её.

const CACHE_PREFIX = 'group_cache_'

// заполняются в loadSchedule() до первой отрисовки приложения (см. main.tsx)
let timetable: Timetable
export let schedule: Schedule
export let START_DAY = 0
export let MAX_WEEK = 1
export let fromCache = false

export const dataUrl = (path: string) => {
  const url = new URL(`data/${path}`, document.baseURI)
  url.searchParams.set('v', String(Date.now()))
  return url
}

async function fetchGroup(id: string): Promise<GroupFile> {
  const res = await fetch(dataUrl(`schedule/${id}.json`), { cache: 'no-store' })
  if (!res.ok) throw new Error(`schedule/${id}.json: HTTP ${res.status}`)
  return (await res.json()) as GroupFile
}

// Файл группы: свежий, а если сети нет — сохранённый
async function loadGroup(id: string): Promise<GroupFile> {
  try {
    const file = await fetchGroup(id)
    writeLocal(CACHE_PREFIX + id, JSON.stringify(file))
    return file
  } catch (err) {
    const cached = readLocal(CACHE_PREFIX + id)
    if (!cached) throw err
    console.warn(`Не удалось скачать расписание ${id} — показываю сохранённую копию`, err)
    fromCache = true
    return JSON.parse(cached) as GroupFile
  }
}

// Какие группы нужны при запуске: группа из настроек. Пока все пользователи — МБ(МП) 1-1/1-2,
// и над расписанием переключатель «1-1 / 1-2», поэтому грузим обе.
export function startGroups(): string[] {
  try {
    const saved = normalizeGroup((JSON.parse(readLocal('prefs') ?? '{}') as { group?: string }).group)
    if (saved && !MB_IDS.includes(saved)) return [saved]
  } catch {
    // нет сохранённых настроек — группа по умолчанию
  }
  return MB_IDS
}

export async function loadSchedule(ids: string[] = startGroups()): Promise<void> {
  const files = await Promise.all(ids.map(loadGroup))
  // правки встроены в сборку: overrides.json и замены дней целиком (overrides/thursday*.json)
  timetable = makeTimetable(scheduleFromGroups(files), rawOverrides as Overrides, [
    thursday as DayReplacement,
    thursday12 as DayReplacement,
  ])
  schedule = timetable.schedule
  START_DAY = timetable.startDay
  MAX_WEEK = timetable.maxWeek
}

export const weekOf = (day: number) => timetable.weekOf(day)
export const weekdayOf = (day: number) => timetable.weekdayOf(day)
export const dayOf = (week: number, weekday: number) => timetable.dayOf(week, weekday)
export const inSemester = (week: number) => timetable.inSemester(week)
export const pairNumber = (lesson: Pick<Lesson, 'group' | 'weekday' | 'start'>) => timetable.pairNumber(lesson)
export const groupName = (id: string) => timetable.nameOf(id)

export function lessonsOn(group: string, week: number, weekday: number): Lesson[] {
  return timetable.lessonsOn(group, week, weekday)
}
