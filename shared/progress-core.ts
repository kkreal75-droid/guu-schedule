// Ход предмета (этап 12): все занятия «предмет + вид + кто» за семестр — у студента «кто» = преподаватель, у
// преподавателя = группы пары. С правками (отмены и перенос отсюда не считаются, перенос сюда и пара, добавленная
// старостой, — считаются), скрытыми парами и подгруппами — тем же dayLessons, что рисует день. Номер недели и даты —
// функциями расписания (tt.weekOf / tt.dayOf), как везде. Одна пара — 2 академических часа.
import { dayLessons, type Extras } from './edits-core'
import { toMinutes, type Lesson, type Timetable } from './schedule-core'

export type Occurrence = { day: number; week: number; start: string; end: string }

export type Progress = {
  total: number
  done: number // прошло (закончились к этому моменту)
  left: number
  hours: number // академические часы: пара = 2
  first: Occurrence
  last: Occurrence
  finished: boolean
}

export const HOURS_PER_PAIR = 2

type CourseLesson = Pick<Lesson, 'subject' | 'kind' | 'teacher' | 'teachers' | 'audience'>

// «Королева Н. Ш.» (так могла написать староста) и «Королева Н.Ш.» — один преподаватель
const teacherOf = (l: CourseLesson) => (l.teachers ?? (l.teacher ? [l.teacher] : [])).join(', ').replace(/\.\s+(?=\S)/g, '.').trim()

// «Макроэкономика|Практика|Королева Н.Ш.» у студента, «Макроэкономика|Практика|b1-mb-mp-2» у преподавателя
export const courseKey = (l: CourseLesson) =>
  [l.subject, l.kind ?? '', l.audience ? l.audience.map((a) => a.id).sort().join(',') : teacherOf(l)].join('|')

// Недели в файле ГУУ не указаны — пара стоит на весь семестр (физкультура, «Проектное обучение»): там считать
// «осталось» бессмысленно. Признак — недели с 1–2-й до конца семестра подряд или через одну.
export function wholeSemester(weeks: number[], maxWeek: number): boolean {
  if (weeks.length < 2) return false
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)
  const step = sorted[1] - sorted[0]
  if (step !== 1 && step !== 2) return false
  return sorted[0] <= 2 && sorted.at(-1)! >= maxWeek - 1 && sorted.every((w, i) => i === 0 || w - sorted[i - 1] === step)
}

// Все занятия группы (или преподавателя «t-<id>») по предметам: ключ → занятия по порядку. Предметы «на весь
// семестр» (wholeSemester) не попадают. mine — свои подгруппы (как в расписании)
export function courseOccurrences(tt: Timetable, group: string, extras: Extras, mine: number[] | null = null): Map<string, Occurrence[]> {
  // какие недели у предмета в файле ГУУ — до правок
  const weeks = new Map<string, number[]>()
  for (const l of tt.schedule.lessons) {
    if (l.group !== group) continue
    const key = courseKey(l)
    weeks.set(key, [...(weeks.get(key) ?? []), ...l.weeks])
  }
  const out = new Map<string, Occurrence[]>()
  for (let week = 1; week <= tt.maxWeek; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = tt.dayOf(week, weekday)
      for (const l of dayLessons(tt, group, day, extras, mine).lessons) {
        if (l.cancel || l.movedTo) continue
        const key = courseKey(l)
        const raw = weeks.get(key)
        if (raw && wholeSemester(raw, tt.maxWeek)) continue
        const list = out.get(key) ?? []
        list.push({ day, week, start: l.start, end: l.end })
        out.set(key, list)
      }
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
  return out
}

// Сколько прошло и осталось к моменту now (день и минуты по Москве)
export function progressOf(list: Occurrence[], now: { day: number; minutes: number }): Progress | null {
  if (!list.length) return null
  const done = list.filter((o) => o.day < now.day || (o.day === now.day && toMinutes(o.end) <= now.minutes)).length
  return {
    total: list.length,
    done,
    left: list.length - done,
    hours: list.length * HOURS_PER_PAIR,
    first: list[0],
    last: list.at(-1)!,
    finished: done === list.length,
  }
}

// Какое по счёту это занятие (1…N); не нашли — 0
export const occurrenceIndex = (list: Occurrence[], day: number, start: string) =>
  list.findIndex((o) => o.day === day && o.start === start) + 1
