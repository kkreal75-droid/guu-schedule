// Мероприятия проектного обучения с make.events (этап 13) — одна логика для приложения и бота.
// Файл public/data/events.json пишет update.py раз в час: предстоящие + сегодняшние + 7 дней архива.
// Время — «настенное» в поясе мероприятия, как на make.events («2026-10-29T10:40»); конца часто нет.
// Данные чужие: на сайте они уже очищены (текст без HTML, лимиты длины), показываем только как текст.

export type MakeEvent = {
  id: string
  title: string
  start: string // «2026-10-29T10:40»
  end: string | null
  place: string | null
  description: string // абзацы — строками
  url: string // https://guu.make.events/eventsNew/<id>
}

export type EventsFile = { source: string; updated_at: string; events: MakeEvent[] }

export const EVENTS_COMMUNITY_URL = 'https://make.events/community/cPsmzW/public/events'

// «Проектное обучение» в файле ГУУ — весь четверг у большинства групп (6 пар, вид не указан)
export const isProjectLesson = (lesson: { subject: string }) => lesson.subject.trim().toLowerCase() === 'проектное обучение'

export const eventDay = (event: MakeEvent) => event.start.slice(0, 10)
export const eventTime = (iso: string) => iso.slice(11, 16)

export const eventsOn = (events: MakeEvent[], isoDay: string) =>
  events.filter((e) => eventDay(e) === isoDay).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))

// блоки дня по времени начала: «10:40 — 6 мероприятий»
export function eventBlocks(events: MakeEvent[]): { time: string; events: MakeEvent[] }[] {
  const blocks = new Map<string, MakeEvent[]>()
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))) {
    const time = eventTime(e.start)
    blocks.set(time, [...(blocks.get(time) ?? []), e])
  }
  return [...blocks].map(([time, list]) => ({ time, events: list }))
}

// «Записаться» открываем только на make.events и его поддоменах
export function isEventUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return u.protocol === 'https:' && (host === 'make.events' || host.endsWith('.make.events'))
  } catch {
    return false
  }
}
