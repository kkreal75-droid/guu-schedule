import rawOverrides from '../overrides.json'
import thursday from '../overrides/thursday.json'
import thursday12 from '../overrides/thursday-1-2.json'
import { isMbGroup } from '../shared/groups'
import {
  makeTimetable,
  scheduleFromGroups,
  teacherAsGroup,
  teacherKey,
  type DayReplacement,
  type GroupFile,
  type Lesson,
  type Overrides,
  type Schedule,
  type TeacherFile,
  type Timetable,
} from '../shared/schedule-core'
import type { Prefs } from './prefs'
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

// Группы больше нет на сайте (пропала из расписания ГУУ) — надо выбрать заново
export class GroupMissingError extends Error {}

// Файл группы (или «t-<id>» — расписание преподавателя)
async function fetchGroup(id: string): Promise<GroupFile> {
  const path = id.startsWith('t-') ? `teachers/${id.slice(2)}.json` : `schedule/${id}.json`
  const res = await fetch(dataUrl(path), { cache: 'no-store' })
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) throw new GroupMissingError(id)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  const data = await res.json()
  return id.startsWith('t-') ? teacherAsGroup(data as TeacherFile) : (data as GroupFile)
}

// Файл группы: свежий, а если сети нет — сохранённый
async function loadGroup(id: string): Promise<GroupFile> {
  try {
    const file = await fetchGroup(id)
    writeLocal(CACHE_PREFIX + id, JSON.stringify(file))
    return file
  } catch (err) {
    const cached = err instanceof GroupMissingError ? null : readLocal(CACHE_PREFIX + id)
    if (!cached) throw err
    console.warn(`Не удалось скачать расписание ${id} — показываю сохранённую копию`, err)
    fromCache = true
    return JSON.parse(cached) as GroupFile
  }
}

// Своё расписание: преподавателю — его пары («t-<id>»), студенту — его группа
export const homeOf = (prefs: Prefs) => (prefs.role === 'teacher' && prefs.teacher ? teacherKey(prefs.teacher) : prefs.group)

// Какие расписания нужны: своё и избранное (этап 12: группы и преподаватели вперемешку; у МБ(МП) 1-1/1-2
// вторая группа — обычный чип избранного, см. migrateFavorites)
export function groupsToLoad(prefs: Prefs): string[] {
  return [...new Set([homeOf(prefs), ...prefs.favorites])]
}

// Первая группа — главная: её нет — GroupMissingError; избранные, которых больше нет, пропускаем
export async function loadSchedule(ids: string[]): Promise<void> {
  const loaded = await Promise.all(
    ids.map((id, i) => (i === 0 || (isMbGroup(id) && isMbGroup(ids[0])) ? loadGroup(id) : loadGroup(id).catch(() => null))),
  )
  const files = loaded.filter((f): f is GroupFile => f !== null)
  // правки встроены в сборку: overrides.json и замены дней целиком (overrides/thursday*.json)
  timetable = buildTimetable(files)
  schedule = timetable.schedule
  START_DAY = timetable.startDay
  MAX_WEEK = timetable.maxWeek
}

// Расписание любых групп (поиск в «Ещё»): те же правки, что у своего
export function buildTimetable(files: GroupFile[]): Timetable {
  return makeTimetable(scheduleFromGroups(files), rawOverrides as Overrides, [
    thursday as DayReplacement,
    thursday12 as DayReplacement,
  ])
}

export { fetchGroup }
export const getTimetable = () => timetable

export const weekOf = (day: number) => timetable.weekOf(day)
export const weekdayOf = (day: number) => timetable.weekdayOf(day)
export const dayOf = (week: number, weekday: number) => timetable.dayOf(week, weekday)
export const inSemester = (week: number) => timetable.inSemester(week)
export const pairNumber = (lesson: Pick<Lesson, 'group' | 'weekday' | 'start'>) => timetable.pairNumber(lesson)
export const groupName = (id: string) => timetable.nameOf(id)

export function lessonsOn(group: string, week: number, weekday: number): Lesson[] {
  return timetable.lessonsOn(group, week, weekday)
}
