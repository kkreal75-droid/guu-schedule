// Мероприятия проектного обучения с make.events (этап 13): файл data/events.json на сайте пишет update.py
// раз в час. Здесь:
//   GET /event/<id>.ics — одно мероприятие в календарь (кнопка «В календарь» в приложении);
//   строка в утренней сводке беседы — «Сегодня проектное обучение — N мероприятий».
// Данные чужие: на сайте уже очищены, здесь ещё раз — экранирование под .ics и HTML Telegram, лимиты длины.
import { EVENTS_COMMUNITY_URL, eventsOn, isEventUrl, isProjectLesson, type EventsFile, type MakeEvent } from '../../shared/events-core'
import { dayLessons } from '../../shared/edits-core'
import { isoFromDay } from '../../shared/schedule-core'
import { MOSCOW_TZ, escapeText, fold, utcStamp } from './calendar'
import { tr, trn, type Locale } from './i18n'
import type { BotTimetable } from './schedule'

const TTL_MS = 5 * 60_000
let memory: { at: number; events: MakeEvent[] } | null = null

export async function loadEvents(env: Env): Promise<MakeEvent[]> {
  if (memory && Date.now() - memory.at < TTL_MS) return memory.events
  const res = await fetch(new URL('data/events.json', env.WEBAPP_URL).toString(), { cf: { cacheTtl: 300, cacheEverything: true } })
  if (res.status === 404) return [] // сайт ещё без файла (первый деплой) — мероприятий нет, это не ошибка
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`)
  const data = (await res.json()) as EventsFile
  const events = Array.isArray(data.events) ? data.events : []
  memory = { at: Date.now(), events }
  return events
}


const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const stamp = (local: string) => `${local.slice(0, 10).replace(/-/g, '')}T${local.slice(11, 16).replace(':', '')}00`
const clean = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\r/g, '').slice(0, max) : '')

// .ics одного мероприятия: время — московское «настенное» (как показано в приложении), без конца — полтора часа
export function eventIcs(event: MakeEvent, now = new Date()): string | null {
  if (!LOCAL.test(event.start) || (event.end && !LOCAL.test(event.end))) return null
  const url = isEventUrl(event.url) ? event.url : EVENTS_COMMUNITY_URL
  const description = [clean(event.description, 4000), url].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GUU Schedule//Make.Events//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...MOSCOW_TZ,
    'BEGIN:VEVENT',
    `UID:event-${event.id}@guu-schedule`,
    `DTSTAMP:${utcStamp(now.toISOString())}`,
    `DTSTART;TZID=Europe/Moscow:${stamp(event.start)}`,
    event.end ? `DTEND;TZID=Europe/Moscow:${stamp(event.end)}` : 'DURATION:PT1H30M',
    `SUMMARY:${escapeText(clean(event.title, 300))}`,
    ...(event.place ? [`LOCATION:${escapeText(clean(event.place, 200))}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export async function handleEventIcs(env: Env, id: string): Promise<Response> {
  const event = (await loadEvents(env)).find((e) => e.id === id)
  const ics = event && eventIcs(event)
  if (!ics) return new Response('Мероприятие не найдено · Event not found', { status: 404 })
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="event-${id}.ics"`,
      'Cache-Control': 'public, max-age=300',
    },
  })
}

// Строка утренней сводки: у группы сегодня «Проектное обучение» — сколько мероприятий на make.events
export function projectLine(tt: BotTimetable, group: string, day: number, events: MakeEvent[] | null, loc: Locale): string | null {
  if (!events) return null
  if (!dayLessons(tt, group, day, tt.extras).lessons.some((l) => isProjectLesson(l) && !l.cancel && !l.movedTo)) return null
  const n = eventsOn(events, isoFromDay(day)).length
  const link = `<a href="${EVENTS_COMMUNITY_URL}">Make.Events</a>`
  return n
    ? `🚀 ${tr(loc.lang, 'Сегодня проектное обучение — {n} {events}', { n, events: trn(loc.lang, n, 'мероприятие|мероприятия|мероприятий') })} · ${link}`
    : `🚀 ${tr(loc.lang, 'Сегодня проектное обучение — мероприятий пока нет')} · ${link}`
}
