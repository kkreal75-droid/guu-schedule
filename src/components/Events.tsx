import { useCallback, useState } from 'react'
import { EVENTS_COMMUNITY_URL, eventTime, isEventUrl, type MakeEvent } from '../../shared/events-core'
import { dayFromIso } from '../../shared/schedule-core'
import { formatDate, weekdayFull } from '../format'
import { useEvents } from '../events'
import { BOT_URL, haptic, openLink } from '../telegram'
import { Sheet } from './Sheet'
import { ChevronRight, Icon } from '../icons'
import { t, tn } from '../i18n'

// Мероприятия make.events (этап 13): строка списка, окно снизу, блок «Проектное обучение» в конце дня.
// Названия и описания — от организаторов, по-русски (lang="ru"), только текстом.

const short = (time: string) => time.replace(/^0(\d)/, '$1')
// описание, повторяющее название («Роль классификаторов» / «Роль классификаторов»), не показываем
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const extraText = (event: MakeEvent) => (event.description && squash(event.description) !== squash(event.title) ? event.description : '')
// в списке — одна мысль: первое предложение описания
const firstSentence = (text: string) => text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s/)[0]
const countText = (n: number) => `${n} ${tn(n, 'мероприятие|мероприятия|мероприятий')}`
const weekdayOf = (day: number) => (((day - 4) % 7) + 7) % 7 // 1970-01-01 — четверг; 0 = понедельник
const dayTitle = (iso: string) => {
  const day = dayFromIso(iso)
  return `${weekdayFull(weekdayOf(day))}, ${formatDate(day)}`
}

// Строка списка «Сервисы → Мероприятия ГУУ»: время и место серой строкой, название, первое предложение описания
export function EventCard({ event, showTime, onOpen }: { event: MakeEvent; showTime?: boolean; onOpen: (e: MakeEvent) => void }) {
  const extra = extraText(event)
  return (
    <button type="button" className="row row-btn event-row" onClick={() => (haptic(), onOpen(event))}>
      {showTime && (
        <span className="event-when">
          {short(eventTime(event.start))}
          {event.place && (
            <>
              {' · '}
              <span lang="ru">{event.place}</span>
            </>
          )}
        </span>
      )}
      <span className="event-title" lang="ru">
        {event.title}
      </span>
      {extra && (
        <span className="event-desc" lang="ru">
          {firstSentence(extra)}
        </span>
      )}
    </button>
  )
}

// Окно снизу: название, день и время, место, описание; «Записаться» — на make.events, «В календарь» — .ics
export function EventSheet({ event, onClose }: { event: MakeEvent; onClose: () => void }) {
  const start = short(eventTime(event.start))
  const end = event.end ? short(eventTime(event.end)) : null
  const extra = extraText(event)
  return (
    <Sheet label={event.title} onClose={onClose} className="event-sheet">
      <h2 className="sheet-title" lang="ru">
        {event.title}
      </h2>
      <p className="sheet-sub">
        {dayTitle(event.start.slice(0, 10))}, {start}
        {end && `–${end}`}
      </p>
      {event.place && (
        <p className="event-place">
          <Icon name="map-pin" size={18} />
          <span lang="ru">{event.place}</span>
        </p>
      )}
      {extra && (
        <div className="event-text" lang="ru">
          {extra.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <div className="sheet-actions">
        {isEventUrl(event.url) && (
          <button type="button" className="button-primary" onClick={() => (haptic(), openLink(event.url))}>
            {t('Записаться')}
            <Icon name="arrow-up-right" size={18} strokeWidth={1.8} />
          </button>
        )}
        {BOT_URL && (
          <button type="button" className="link-btn" onClick={() => (haptic(), openLink(`${BOT_URL}/event/${event.id}.ics`))}>
            <Icon name="calendar" size={18} />
            {t('В календарь')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

const openCommunity = () => (haptic(), openLink(EVENTS_COMMUNITY_URL))

const onDay = (events: MakeEvent[] | null | 'error', iso: string) =>
  Array.isArray(events) ? events.filter((e) => e.start.startsWith(iso)) : events

// «Проектное обучение» в конце дня: время и число мероприятий, сразу полный список мероприятий дня (время и место,
// название, первое предложение описания; нажатие — окно мероприятия), «Все мероприятия».
// from/to — пары «Проектного обучения» у группы (нет — весь день проектный).
export function ProjectDay({ iso, from, to, onAll }: { iso: string; from?: string; to?: string; onAll?: () => void }) {
  const all = useEvents()
  const events = onDay(all, iso)
  const [sheet, setSheet] = useState<MakeEvent | null>(null)
  const close = useCallback(() => setSheet(null), [])
  const list = Array.isArray(events) ? [...events].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)) : []

  return (
    <section className="project">
      <p className="project-title">{t('Проектное обучение')}</p>
      <p className="project-sub">
        {from && to ? `${short(from)}–${short(to)}` : t('Весь день')}
        {' · '}
        {list.length ? t('{events} на make.events', { events: countText(list.length) }) : 'make.events'}
      </p>
      {events === null ? (
        <p className="project-status">{t('Загружаю мероприятия…')}</p>
      ) : events === 'error' || !list.length ? (
        <p className="project-status">{events === 'error' ? t('Не удалось загрузить мероприятия. Проверьте интернет.') : t('Мероприятий на этот день пока нет')}</p>
      ) : (
        <div className="list">
          {list.map((e) => (
            <EventCard key={e.id} event={e} showTime onOpen={setSheet} />
          ))}
        </div>
      )}
      <button type="button" className="link-btn project-all" onClick={() => (onAll ? (haptic(), onAll()) : openCommunity())}>
        {t('Все мероприятия')}
        <ChevronRight width={6} height={10} />
      </button>
      {sheet && <EventSheet event={sheet} onClose={close} />}
    </section>
  )
}

export { countText as eventsCountText, dayTitle as eventDayTitle }
