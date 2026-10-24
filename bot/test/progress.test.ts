// Ход предмета и правки групп в расписании преподавателя (этап 12) — на настоящих файлах ГУУ.
import { describe, expect, it } from 'vitest'
import { newUser, postAs, sql } from './helpers'
import { courseOccurrences, progressOf, occurrenceIndex, wholeSemester } from '../../shared/progress-core'
import { NO_EXTRAS, dayLessons, type Extras, type ScheduleEdit } from '../../shared/edits-core'
import {
  dayFromIso, isoFromDay, makeTimetable, scheduleFromGroups, teacherAsGroup,
  type DayReplacement, type GroupFile, type Overrides, type TeacherFile,
} from '../../shared/schedule-core'
import mb12 from '../../public/data/schedule/b1-mb-mp-2.json'
import koroleva from '../../public/data/teachers/koroleva-n-sh.json'
import overrides from '../../overrides.json'
import thursday11 from '../../overrides/thursday.json'
import thursday12 from '../../overrides/thursday-1-2.json'

const build = (files: GroupFile[]) =>
  makeTimetable(scheduleFromGroups(files), overrides as Overrides, [thursday11 as DayReplacement, thursday12 as DayReplacement])
const student = build([mb12 as GroupFile])
const teacher = build([teacherAsGroup(koroleva as TeacherFile)])
const T = 't-koroleva-n-sh'
const MACRO_STUDENT = 'Макроэкономика|Практика|Королева Н.Ш.'
const MACRO_TEACHER = 'Макроэкономика|Практика|b1-mb-mp-2'
const at = (iso: string, hhmm = '00:00') => ({ day: dayFromIso(iso), minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) })
const extrasWith = (edits: Partial<ScheduleEdit>[]): Extras => ({ ...NO_EXTRAS, edits: edits.map((e, i) => ({ id: i + 1, text: '', start: null, ...e }) as ScheduleEdit) })

describe('ход предмета', () => {
  // В файле ГУУ (-143, 24.10) у МБ(МП) 1-2 практика Королевой — пятница 10:40 по неделям 2, 4, 6, 8, 12, 14 (6 занятий;
  // в -142 было 2–12 по чётным) и вторник 16:15 по неделям 3, 5, 7, 9, 11, 15 (ещё 6): связка «преподаватель + предмет +
  // вид + группа» — 12 занятий
  it('Королева Н.Ш., Макроэкономика, ПЗ, МБ(МП) 1-2: 12 занятий (пт 2–8, 12, 14 + вт 3–11, 15), 24 ак. ч, последнее 08.12', () => {
    for (const [tt, group, key] of [[student, 'b1-mb-mp-2', MACRO_STUDENT], [teacher, T, MACRO_TEACHER]] as const) {
      const list = courseOccurrences(tt, group, NO_EXTRAS).get(key)!
      expect(list.map((o) => o.week)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15])
      expect(list.filter((o) => o.start === '10:40').map((o) => o.week)).toEqual([2, 4, 6, 8, 12, 14]) // пятница
      const p = progressOf(list, at('2026-10-23', '13:00'))!
      expect(p).toMatchObject({ total: 12, hours: 24, done: 7, left: 5, finished: false })
      expect(isoFromDay(p.last.day)).toBe('2026-12-08')
      expect(p.last.week).toBe(15)
      expect(isoFromDay(list.filter((o) => o.start === '10:40').at(-1)!.day)).toBe('2026-12-04') // последняя пятничная — 14-я неделя
      expect(occurrenceIndex(list, dayFromIso('2026-10-23'), '10:40')).toBe(7)
    }
    // до конца пары 23.10 — прошло 6
    expect(progressOf(courseOccurrences(student, 'b1-mb-mp-2', NO_EXTRAS).get(MACRO_STUDENT)!, at('2026-10-23', '11:00'))!.done).toBe(6)
  })

  it('без явных недель (физкультура на весь семестр) — без хода', () => {
    expect(wholeSemester([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], 18)).toBe(true)
    expect(wholeSemester([1, 3, 5, 7, 9, 11, 13, 15, 17], 18)).toBe(true)
    expect(wholeSemester([2, 4, 6, 8, 10, 12], 18)).toBe(false)
    expect(wholeSemester([17], 18)).toBe(false)
    const keys = [...courseOccurrences(student, 'b1-mb-mp-2', NO_EXTRAS).keys()]
    expect(keys.some((k) => k.startsWith('Физическая культура и спорт|Практика'))).toBe(false)
    expect(keys.some((k) => k.startsWith('Физическая культура и спорт|Лекция'))).toBe(true) // одна 17-я неделя
  })

  it('отмена старостой — у студента и у преподавателя на одно занятие меньше', () => {
    const extras = extrasWith([{ group: 'b1-mb-mp-2', date: '2026-11-20', start: '10:40', kind: 'cancel' }])
    expect(courseOccurrences(student, 'b1-mb-mp-2', extras).get(MACRO_STUDENT)!.length).toBe(11)
    expect(courseOccurrences(teacher, T, extras).get(MACRO_TEACHER)!.length).toBe(11)
  })

  it('у потока одна группа отменила — у преподавателя лекция остаётся; все — отменена', () => {
    const day = '2026-10-23' // пятница, 8-я неделя: лекция 09:00 у УП 1-1 и УП 1-2
    const one = extrasWith([{ group: 'b1-up-1-iom', date: day, start: '09:00', kind: 'cancel' }])
    const lecture = (x: Extras) => dayLessons(teacher, T, dayFromIso(day), x).lessons.find((l) => l.start === '09:00')!
    expect(lecture(one).cancel).toBeNull()
    const both = extrasWith([
      { group: 'b1-up-1-iom', date: day, start: '09:00', kind: 'cancel' },
      { group: 'b1-up-2-iom', date: day, start: '09:00', kind: 'cancel' },
    ])
    expect(lecture(both).cancel).not.toBeNull()
    expect(lecture(one).audience?.map((a) => a.name)).toEqual(['УП 1-1 · ИОМ', 'УП 1-2 · ИОМ'])
  })

  it('пара, добавленная старостой с этим преподавателем, — и у него', () => {
    const extras = extrasWith([
      { group: 'b1-mb-mp-2', date: '2026-11-21', kind: 'add', data: { start: '09:00', end: '10:30', subject: 'Макроэкономика', kind: 'Практика', teacher: 'Королева Н. Ш.' } },
    ])
    expect(courseOccurrences(student, 'b1-mb-mp-2', extras).get(MACRO_STUDENT)!.length).toBe(13)
    const list = courseOccurrences(teacher, T, extras).get(MACRO_TEACHER)!
    expect(list.length).toBe(13)
    expect(list.some((o) => isoFromDay(o.day) === '2026-11-21')).toBe(true)
  })
})

describe('избранное (D1)', () => {
  it('сохраняется по порядку, лишнее отбрасывается, старое устройство не затирает новое; приходит в /seen', async () => {
    const id = newUser()
    const ok = await postAs(id, '/favorites', { list: ['t-koroleva-n-sh', 'b1-mb-mp-1', 'МБ(МП) 1-2', 'b1-mb-mp-1'], at: 2000 })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { favorites: string[] }).favorites).toEqual(['t-koroleva-n-sh', 'b1-mb-mp-1', 'b1-mb-mp-2'])
    expect((await postAs(id, '/favorites', { list: ['<script>'] })).status).toBe(400)
    expect((await postAs(id, '/favorites', { list: Array.from({ length: 51 }, (_, i) => `g-${i}`) })).status).toBe(400)
    await postAs(id, '/favorites', { list: ['b1-gmu-3'], at: 1000 }) // старее — не применится
    expect(await sql('SELECT favorites, favorites_at FROM users WHERE id = ?', id).first()).toEqual({
      favorites: JSON.stringify(['t-koroleva-n-sh', 'b1-mb-mp-1', 'b1-mb-mp-2']),
      favorites_at: 2000,
    })
    const seen = (await (await postAs(id, '/seen', { v: 2 })).json()) as { me: { favorites: string[]; favorites_at: number } }
    expect(seen.me.favorites).toEqual(['t-koroleva-n-sh', 'b1-mb-mp-1', 'b1-mb-mp-2'])
    expect(seen.me.favorites_at).toBe(2000)
  })
})
