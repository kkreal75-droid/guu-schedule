// Мероприятия make.events (этап 13): .ics одного мероприятия и строка в утренней сводке.
import { beforeAll, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { EVENTS, call, mockOutbound, telegramCalls } from './helpers'
import { runDigests } from '../src/digest'
import { eventIcs, projectLine } from '../src/events'
import { RU } from '../src/i18n'
import { eventBlocks, eventsOn, isEventUrl, isProjectLesson, type MakeEvent } from '../../shared/events-core'
import { NO_EXTRAS } from '../../shared/edits-core'
import { dayFromIso, makeTimetable, scheduleFromGroups, type DayReplacement, type GroupFile, type Overrides } from '../../shared/schedule-core'
import type { BotTimetable } from '../src/schedule'
import mb11 from '../../public/data/schedule/b1-mb-mp-1.json'
import other from '../../public/data/schedule/b1-gmu-1.json'
import overrides from '../../overrides.json'
import thursday11 from '../../overrides/thursday.json'

beforeAll(() => mockOutbound())

const events = EVENTS.events as MakeEvent[]
const tt = {
  ...makeTimetable(scheduleFromGroups([mb11 as GroupFile, other as GroupFile]), overrides as Overrides, [thursday11 as DayReplacement]),
  extras: NO_EXTRAS,
  replacements: [],
} as BotTimetable

describe('мероприятия: общее', () => {
  it('блоки по времени начала, по порядку', () => {
    const day = eventsOn(events, '2026-10-29')
    expect(day.map((e) => e.id)).toEqual(['bbb222', 'aaa111', 'ccc333']) // в одно время — по названию
    expect(eventBlocks(day).map((b) => [b.time, b.events.length])).toEqual([['10:40', 2], ['16:00', 1]])
  })

  it('«Записаться» — только make.events и поддомены по https', () => {
    expect(isEventUrl('https://guu.make.events/eventsNew/aaa111')).toBe(true)
    expect(isEventUrl('https://make.events/community/cPsmzW/public/events')).toBe(true)
    expect(isEventUrl('http://guu.make.events/x')).toBe(false)
    expect(isEventUrl('https://make.events.evil.example/x')).toBe(false)
    expect(isEventUrl('javascript:alert(1)')).toBe(false)
  })

  it('«Проектное обучение» узнаём по названию', () => {
    expect(isProjectLesson({ subject: 'Проектное обучение' })).toBe(true)
    expect(isProjectLesson({ subject: 'Основы проектного управления' })).toBe(false)
  })
})

describe('мероприятие в календарь', () => {
  it('.ics: московское время, экранирование, без конца — полтора часа', () => {
    const ics = eventIcs(events[0])!.replace(/\r\n /g, '') // строки длиннее 75 байт перенесены (RFC 5545)
    expect(ics).toContain('DTSTART;TZID=Europe/Moscow:20261029T104000')
    expect(ics).toContain('DURATION:PT1H30M')
    expect(ics).toContain('SUMMARY:Кейс-клуб\\; встреча\\, первая')
    expect(ics).toContain('DESCRIPTION:Строка 1\\nСтрока 2\\n\\nhttps://guu.make.events/eventsNew/aaa111')
  })

  it('.ics: переводы строк в названии не добавляют свои поля, чужая ссылка — на сообщество', () => {
    const ics = eventIcs(events[1])!
    expect(ics.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1)
    expect(ics).not.toMatch(/^SUMMARY:x/m)
    expect(ics).toContain('DTEND;TZID=Europe/Moscow:20261029T121000')
    expect(ics).toContain('URL:https://make.events/community/cPsmzW/public/events')
    expect(ics).not.toContain('evil.example')
  })

  it('GET /event/<id>.ics — есть: календарь, нет: 404', async () => {
    const ok = await call('/event/aaa111.ics')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toContain('text/calendar')
    expect(await ok.text()).toContain('UID:event-aaa111@guu-schedule')
    expect((await call('/event/zzz999.ics')).status).toBe(404)
    expect((await call('/event/a%2Fb.ics')).status).toBe(404)
  })
})

describe('строка в утренней сводке', () => {
  const thursday = dayFromIso('2026-10-29')
  it('у группы «Проектное обучение» — число мероприятий дня', () => {
    expect(projectLine(tt, 'b1-gmu-1', thursday, events, RU)).toContain('Сегодня проектное обучение — 3 мероприятия')
    // у МБ(МП) 1-1 четверг — свои пары, но «Проектное обучение» в 16:15 и 17:55 осталось
    expect(projectLine(tt, 'b1-mb-mp-1', thursday, events, RU)).toContain('3 мероприятия')
    expect(projectLine(tt, 'b1-gmu-1', thursday, events, { lang: 'en', names: null })).toContain('Project learning today — 3 events')
  })
  it('в другой день, без данных или без мероприятий', () => {
    expect(projectLine(tt, 'b1-gmu-1', thursday + 1, events, RU)).toBeNull()
    expect(projectLine(tt, 'b1-gmu-1', thursday, null, RU)).toBeNull()
    expect(projectLine(tt, 'b1-gmu-1', thursday + 7, events, RU)).toContain('мероприятий пока нет')
  })
})

describe('утренняя сводка в беседе', () => {
  it('в четверг с «Проектным обучением» — строка о мероприятиях, в пятницу — нет', async () => {
    await env.KV.put('chats', JSON.stringify({
      '-1001': { title: 'ГМУ', group: 'b1-gmu-1', time: '07:00', added_at: 0 },
      '-1002': { title: 'GMU en', group: 'b1-gmu-1', time: '07:00', lang: 'en', added_at: 0 },
    }))
    const at = (iso: string) => Date.parse(`${iso}T07:01:00+03:00`)
    telegramCalls.length = 0
    expect(await runDigests(env as unknown as Env, at('2026-10-29'))).toBe(2)
    const texts = telegramCalls.filter((c) => c.method === 'sendMessage').map((c) => (c.body as { text: string }).text)
    expect(texts[0]).toContain('🚀 Сегодня проектное обучение — 3 мероприятия')
    expect(texts[0]).toContain('href="https://make.events/community/cPsmzW/public/events"')
    expect(texts[1]).toContain('Project learning today — 3 events')
    telegramCalls.length = 0
    await runDigests(env as unknown as Env, at('2026-10-30'))
    const friday = telegramCalls.filter((c) => c.method === 'sendMessage').map((c) => (c.body as { text: string }).text)
    expect(friday.length).toBe(2)
    expect(friday.join('\n')).not.toContain('проектное обучение —')
  })
})
