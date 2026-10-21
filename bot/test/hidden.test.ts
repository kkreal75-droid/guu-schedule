// «Это не моя пара»: скрытые пары — только у себя (приложение, .ics по своей ссылке), чужое не трогается;
// владелец скрывает для всей группы; подсказка в админке при ≥ 60% группы; очередь ответов поддержки.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { dayLessons, NO_EXTRAS, type DayLesson } from '../../shared/edits-core'
import { isoFromDay, makeTimetable, scheduleFromGroups, type GroupFile, type Overrides } from '../../shared/schedule-core'
import mb11 from '../../public/data/schedule/b1-mb-mp-1.json'
import mb12 from '../../public/data/schedule/b1-mb-mp-2.json'
import overrides from '../../overrides.json'
import { OWNER, call, eventually, mockOutbound, newUser, postAs, sendUpdate, sql, telegramCalls } from './helpers'

beforeAll(() => mockOutbound())

// пара, которая есть у группы в эти два дня (одна в своё время) — как её видит приложение
function pickLesson(file: GroupFile): { lesson: DayLesson; dates: [string, string] } {
  const tt = makeTimetable(scheduleFromGroups([file]), overrides as Overrides)
  for (let week = 2; week < 12; week++) {
    for (let weekday = 0; weekday < 6; weekday++) {
      if (weekday === 3) continue // четверги МБ — замены из файлов
      const day = tt.dayOf(week, weekday)
      const lessons = dayLessons(tt, file.id, day, NO_EXTRAS).lessons
      for (const lesson of lessons) {
        if (lessons.filter((l) => l.start === lesson.start).length > 1) continue
        const other = lesson.weeks.find((w) => w > week + 1)
        if (other) return { lesson, dates: [isoFromDay(day), isoFromDay(tt.dayOf(other, weekday))] }
      }
    }
  }
  throw new Error('нет подходящей пары')
}

const GROUP = 'b1-mb-mp-2'
const { lesson, dates } = pickLesson(mb12 as GroupFile)
const target = (scope: string, date = dates[0]) => ({ group: GROUP, date, start: lesson.start, subject: lesson.subject, kind: lesson.kind, scope })
const stamp = (iso: string) => `DTSTART;TZID=Europe/Moscow:${iso.replace(/-/g, '')}T${lesson.start.replace(':', '')}00`

async function calendarOf(user: number, group = GROUP): Promise<() => Promise<string>> {
  const res = await postAs(user, '/cal/connect', { group })
  const { url } = (await res.json()) as { url: string }
  const path = new URL(url).pathname
  return async () => (await call(path)).text()
}

async function student(group = GROUP) {
  const id = newUser()
  await postAs(id, '/profile', { role: 'student', group })
  return id
}

describe('скрыть у себя', () => {
  it('пропадает из своего календаря, у другого — нет; «в этот день» — только эта дата', async () => {
    const [me, other] = [await student(), await student()]
    const [mine, theirs] = [await calendarOf(me), await calendarOf(other)]
    expect(await mine()).toContain(stamp(dates[0]))

    const day = await postAs(me, '/hidden/add', target('day'))
    expect(day.status).toBe(200)
    let ics = await mine()
    expect(ics).not.toContain(stamp(dates[0]))
    expect(ics).toContain(stamp(dates[1]))

    expect((await postAs(me, '/hidden/add', target('always'))).status).toBe(200)
    ics = await mine()
    expect(ics).not.toContain(stamp(dates[0]))
    expect(ics).not.toContain(stamp(dates[1]))

    const theirsIcs = await theirs()
    expect(theirsIcs).toContain(stamp(dates[0]))
    expect(theirsIcs).toContain(stamp(dates[1]))
  })

  it('/seen отдаёт свои скрытые пары и только их', async () => {
    const [me, other] = [await student(), await student()]
    await postAs(me, '/hidden/add', target('even'))
    const mineSeen = (await (await postAs(me, '/seen', { v: 2, groups: [GROUP] })).json()) as { my_hidden: { scope: string; subject: string }[] }
    expect(mineSeen.my_hidden).toEqual([expect.objectContaining({ scope: 'even', subject: lesson.subject })])
    const otherSeen = (await (await postAs(other, '/seen', { v: 2, groups: [GROUP] })).json()) as { my_hidden: unknown[] }
    expect(otherSeen.my_hidden).toEqual([])
  })

  it('пары, которой нет, и неверные поля — 400', async () => {
    const me = await student()
    expect((await postAs(me, '/hidden/add', { ...target('always'), subject: 'Нет такой пары' })).status).toBe(400)
    expect((await postAs(me, '/hidden/add', { ...target('always'), start: '07:07' })).status).toBe(400)
    expect((await postAs(me, '/hidden/add', target('forever'))).status).toBe(400)
    expect((await postAs(me, '/hidden/add', { ...target('always'), group: 'evil' })).status).toBe(400)
    expect((await sql('SELECT COUNT(*) AS n FROM hidden_lessons WHERE user_id = ?', me).first<{ n: number }>())!.n).toBe(0)
  })

  it('чужое правило не удалить; своё — удаляется, и пара возвращается в календарь', async () => {
    const [me, other] = [await student(), await student()]
    const mine = await calendarOf(me)
    const { id } = (await (await postAs(me, '/hidden/add', target('always'))).json()) as { id: number }
    expect(await mine()).not.toContain(stamp(dates[0]))
    await postAs(other, '/hidden/delete', { id })
    expect(await sql('SELECT id FROM hidden_lessons WHERE id = ?', id).first()).not.toBeNull()
    await postAs(me, '/hidden/delete', { id })
    expect(await sql('SELECT id FROM hidden_lessons WHERE id = ?', id).first()).toBeNull()
    expect(await mine()).toContain(stamp(dates[0]))
  })
})

describe('для всей группы (владелец)', () => {
  it('видно всем группы в /seen и в календарях; «Вернуть» — снова видно', async () => {
    const member = await student()
    const add = await postAs(OWNER, '/admin/hidden-group-add', { ...target('always'), weekday: lesson.weekday })
    expect(add.status).toBe(200)
    const { group } = (await add.json()) as { group: { id: number; all: boolean }[] }
    expect(group).toEqual([expect.objectContaining({ all: true })])
    const seen = (await (await postAs(member, '/seen', { v: 2, groups: [GROUP] })).json()) as { hidden: unknown[] }
    expect(seen.hidden).toHaveLength(1)
    // кэш правок — минута, календаря — 10 минут в изоляте: проверяем свежий календарь нового человека
    const fresh = await calendarOf(await student())
    expect(await fresh()).not.toContain(stamp(dates[0]))
    await postAs(OWNER, '/admin/hidden-group-delete', { id: group[0].id })
    expect(await sql('SELECT COUNT(*) AS n FROM hidden_lessons WHERE user_id = 0').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('чужому — 403, пары нет у группы — 400', async () => {
    expect((await postAs(newUser(), '/admin/hidden-group-add', { ...target('always'), weekday: lesson.weekday })).status).toBe(403)
    expect((await postAs(OWNER, '/admin/hidden-group-add', { ...target('always'), weekday: (lesson.weekday + 1) % 6, start: '07:07' })).status).toBe(400)
  })

  it('подсказка: ≥ 60% группы скрыли одну пару', async () => {
    const group = 'b1-mb-mp-1'
    const pick = pickLesson(mb11 as GroupFile)
    const body = { group, date: pick.dates[0], start: pick.lesson.start, subject: pick.lesson.subject, kind: pick.lesson.kind, scope: 'odd' }
    const people = [await student(group), await student(group), await student(group)]
    await postAs(people[0], '/hidden/add', body)
    let overview = (await (await postAs(OWNER, '/admin/hidden')).json()) as { windows: { group: string; users: number; members: number; suggest: boolean }[] }
    expect(overview.windows.find((w) => w.group === group)).toMatchObject({ users: 1, members: 3, suggest: false })
    await postAs(people[1], '/hidden/add', body)
    overview = (await (await postAs(OWNER, '/admin/hidden')).json()) as typeof overview
    expect(overview.windows.find((w) => w.group === group)).toMatchObject({ users: 2, members: 3, suggest: true })
  })
})

describe('очередь ответов поддержки', () => {
  it('cron отправляет ответ автору один раз и отмечает answered_at', async () => {
    const author = newUser()
    await sql(`INSERT INTO support_messages (user_id, text, created_at, reply_text) VALUES (?, 'Вопрос', ?, 'Спасибо! Нашли причину.')`, author, Date.now()).run()
    const runCron = async () => {
      const ctx = createExecutionContext()
      await worker.scheduled!(createScheduledController({ scheduledTime: Date.UTC(2026, 9, 21, 9, 1), cron: '* * * * *' }), env as never, ctx)
      await waitOnExecutionContext(ctx)
    }
    const before = telegramCalls.length
    await runCron()
    const sent = telegramCalls.slice(before).filter((c) => c.method === 'sendMessage' && (c.body as { chat_id: number }).chat_id === author)
    expect(sent).toHaveLength(1)
    expect((sent[0].body as { text: string }).text).toContain('Ответ на твоё обращение')
    expect((sent[0].body as { text: string }).text).toContain('Нашли причину')
    const row = await sql('SELECT answered_at FROM support_messages WHERE user_id = ?', author).first<{ answered_at: number | null }>()
    expect(row!.answered_at).toBeGreaterThan(0)
    const again = telegramCalls.length
    await runCron()
    expect(telegramCalls.slice(again).some((c) => (c.body as { chat_id?: number }).chat_id === author)).toBe(false)
  })
})

describe('/deleteme', () => {
  it('стирает скрытые пары человека', async () => {
    const me = await student()
    await postAs(me, '/hidden/add', target('always'))
    await sendUpdate({ update_id: 779_001, callback_query: { id: 'z', from: { id: me, first_name: 'У' }, data: 'dm:yes', message: { message_id: 1, chat: { id: me, type: 'private' } } } })
    await eventually(async () => !(await sql('SELECT id FROM users WHERE id = ?', me).first()))
    expect((await sql('SELECT COUNT(*) AS n FROM hidden_lessons WHERE user_id = ?', me).first<{ n: number }>())!.n).toBe(0)
  })
})
