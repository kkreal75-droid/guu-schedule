// Выходной для всех (overrides.json → days_off): 4 ноября 2026 пар нет ни у групп, ни у преподавателей —
// в приложении (dayLessons), счётчиках занятий, боте (/today, неделя, сводки в беседы, «Изменение в расписании»)
// и в подписке на календарь.
import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { NO_EXTRAS, dayLessons, type Extras, type ScheduleEdit } from '../../shared/edits-core'
import { courseOccurrences } from '../../shared/progress-core'
import {
  dayFromIso, isoFromDay, makeTimetable, scheduleFromGroups, teacherAsGroup,
  type DayReplacement, type GroupFile, type Overrides, type TeacherFile,
} from '../../shared/schedule-core'
import { buildIcs } from '../src/calendar'
import { detectChanges, runDigests } from '../src/digest'
import { formatDay, formatWeek, type BotTimetable } from '../src/schedule'
import { mockOutbound, siteData, sql, telegramCalls } from './helpers'
import mb11 from '../../public/data/schedule/b1-mb-mp-1.json'
import mb12 from '../../public/data/schedule/b1-mb-mp-2.json'
import gmu1 from '../../public/data/schedule/b1-gmu-1.json'
import cunaeva from '../../public/data/teachers/cunaeva-yu-o.json'
import overrides from '../../overrides.json'
import thursday11 from '../../overrides/thursday.json'
import thursday12 from '../../overrides/thursday-1-2.json'

const replacements = [thursday11 as DayReplacement, thursday12 as DayReplacement]
const groups = makeTimetable(scheduleFromGroups([mb11, mb12, gmu1] as GroupFile[]), overrides as Overrides, replacements)
const teacher = makeTimetable(scheduleFromGroups([teacherAsGroup(cunaeva as TeacherFile)]), overrides as Overrides, replacements)
const T = 't-cunaeva-yu-o'
const bot = (tt: typeof groups): BotTimetable => ({ ...tt, extras: NO_EXTRAS, replacements: [] })
const NOV4 = dayFromIso('2026-11-04')
const extrasWith = (edits: Partial<ScheduleEdit>[]): Extras => ({
  ...NO_EXTRAS,
  edits: edits.map((e, i) => ({ id: i + 1, text: '', start: null, ...e }) as ScheduleEdit),
})

describe('4 ноября — выходной для всех', () => {
  it('в overrides.json выходной только 4 ноября', () => {
    expect((overrides as Overrides).days_off).toEqual([{ date: '2026-11-04', title: 'День народного единства', title_en: 'National Unity Day' }])
    expect(groups.dayOff(NOV4)?.title).toBe('День народного единства')
    for (const iso of ['2026-10-28', '2026-11-11', '2026-11-03', '2026-11-05', '2026-12-31']) expect(groups.dayOff(dayFromIso(iso))).toBeNull()
  })

  it('у групп 4.11 пар нет, а 28.10 и 11.11 (тоже среды) — на месте', () => {
    for (const g of ['b1-mb-mp-1', 'b1-mb-mp-2', 'b1-gmu-1']) {
      // в файлах ГУУ пары по средам этих недель есть — выходной убирает их только 4.11
      expect(groups.lessonsOn(g, groups.weekOf(NOV4), 2).length).toBeGreaterThan(0)
      const off = dayLessons(groups, g, NOV4, NO_EXTRAS)
      expect(off.lessons).toEqual([])
      expect(off.dayOff?.title).toBe('День народного единства')
      for (const iso of ['2026-10-28', '2026-11-11']) {
        const view = dayLessons(groups, g, dayFromIso(iso), NO_EXTRAS)
        expect(view.lessons.length).toBeGreaterThan(0)
        expect(view.dayOff).toBeUndefined()
      }
    }
  })

  it('у преподавателя 4.11 пар нет, 28.10 и 11.11 — на месте', () => {
    expect(teacher.lessonsOn(T, teacher.weekOf(NOV4), 2).length).toBeGreaterThan(0)
    expect(dayLessons(teacher, T, NOV4, NO_EXTRAS).lessons).toEqual([])
    for (const iso of ['2026-10-28', '2026-11-11']) expect(dayLessons(teacher, T, dayFromIso(iso), NO_EXTRAS).lessons.length).toBeGreaterThan(0)
  })

  it('пара от старосты на 4.11 не появляется; пара, перенесённая с 4.11 на 6.11, — в новом дне', () => {
    const add = extrasWith([{ group: 'b1-mb-mp-1', date: '2026-11-04', start: '09:00', kind: 'add', data: { start: '09:00', end: '10:30', subject: 'Консультация' } }])
    expect(dayLessons(groups, 'b1-mb-mp-1', NOV4, add).lessons).toEqual([])
    const first = groups.lessonsOn('b1-mb-mp-1', groups.weekOf(NOV4), 2)[0]
    const move = extrasWith([{ group: 'b1-mb-mp-1', date: '2026-11-04', start: first.start, kind: 'move', data: { to_date: '2026-11-06', to_start: '18:00', to_end: '19:30' } }])
    const nov6 = dayLessons(groups, 'b1-mb-mp-1', dayFromIso('2026-11-06'), move).lessons
    expect(nov6.some((l) => l.movedFrom?.date === '2026-11-04' && l.subject === first.subject)).toBe(true)
  })

  it('в счётчиках «Занятие N из M» 4.11 не считается', () => {
    for (const [tt, g] of [[groups, 'b1-mb-mp-1'], [teacher, T]] as const) {
      const days = [...courseOccurrences(tt, g, NO_EXTRAS).values()].flat().map((o) => isoFromDay(o.day))
      expect(days).not.toContain('2026-11-04')
      expect(days).toContain('2026-10-28')
      expect(days).toContain('2026-11-11')
    }
  })

  it('в подписке на календарь нет занятий 4 ноября, 28.10 и 11.11 — есть', () => {
    for (const g of ['b1-mb-mp-1', 'b1-gmu-1']) {
      const ics = buildIcs(bot(groups), g)
      expect(ics).not.toMatch(/DTSTART;TZID=Europe\/Moscow:20261104T/)
      expect(ics).toMatch(/DTSTART;TZID=Europe\/Moscow:20261028T/)
      expect(ics).toMatch(/DTSTART;TZID=Europe\/Moscow:20261111T/)
    }
  })

  it('бот: /today и неделя пишут «Выходной — День народного единства», по-английски — тоже', () => {
    const today = formatDay(bot(groups), NOV4, 'b1-mb-mp-1')
    expect(today).toContain('Выходной — День народного единства 🎉')
    expect(today).not.toContain('Пар нет')
    expect(formatDay(bot(groups), NOV4, 'b1-mb-mp-1', null, { lang: 'en', names: null })).toContain('Day off — National Unity Day 🎉')
    const week = formatWeek(bot(groups), NOV4 - 2, 'b1-gmu-1')
    expect(week).toContain('Выходной — День народного единства 🎉')
    expect(formatDay(bot(groups), dayFromIso('2026-11-11'), 'b1-mb-mp-1')).not.toContain('Выходной')
  })
})

describe('4 ноября — беседы групп', () => {
  beforeAll(async () => {
    mockOutbound()
    await env.KV.put('chats', JSON.stringify({
      '-2001': { title: 'ГМУ', group: 'b1-gmu-1', time: '07:00', added_at: 0 },
      '-2002': { title: 'GMU en', group: 'b1-gmu-1', time: '07:00', lang: 'en', added_at: 0 },
    }))
  })
  const sent = () => telegramCalls.filter((c) => c.method === 'sendMessage').map((c) => (c.body as { text: string }).text)

  it('утренняя сводка — «Выходной — День народного единства», даже если overrides.json на сайте не открылся', async () => {
    siteData['/overrides.json'] = null // сайт не отдал правки — бот берёт overrides.json, с которым его выложили
    telegramCalls.length = 0
    expect(await runDigests(env as unknown as Env, Date.parse('2026-11-04T07:01:00+03:00'))).toBe(2)
    delete siteData['/overrides.json']
    const [ru, en] = sent()
    expect(ru).toBe('☀️ <b>Среда, 4 ноября</b> · ГМУ 1-1\nВыходной — День народного единства 🎉')
    expect(en).toContain('Day off — National Unity Day 🎉')
    expect(en).not.toMatch(/\d\d:\d\d/)
  })

  it('субботняя неделя вперёд: среда 4 ноября — выходной', async () => {
    telegramCalls.length = 0
    await runDigests(env as unknown as Env, Date.parse('2026-10-31T19:01:00+03:00'))
    const [ru, en] = sent()
    expect(ru).toContain('<b>Среда, 4 ноября</b>\nВыходной — День народного единства 🎉\n\n<b>Четверг, 5 ноября</b>')
    expect(en).toContain('Day off — National Unity Day 🎉')
  })

  it('«Изменение в расписании»: пары 4.11 пропали — одна строка «Выходной», без списка «было»', async () => {
    const before = { '2026-11-04': ['09:00–10:30 · <b>Математика</b> (Лекция) · У-349'] }
    await sql('INSERT INTO group_snapshots (grp, data, updated_at) VALUES (?1, ?2, 0)', 'b1-gmu-1', JSON.stringify(before)).run()
    telegramCalls.length = 0
    await detectChanges(env as unknown as Env, Date.parse('2026-10-29T12:05:00+03:00'))
    const [ru, en] = sent()
    expect(ru).toBe('⚠️ <b>Изменение в расписании</b> · ГМУ 1-1\n\n<b>Среда, 4 ноября</b>\nВыходной — День народного единства 🎉')
    expect(en).toContain('Day off — National Unity Day 🎉')
    expect(en).not.toContain('was:')
  })
})
