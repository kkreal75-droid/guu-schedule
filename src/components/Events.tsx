import { useCallback, useState, type ReactNode } from 'react'
import { EVENTS_COMMUNITY_URL, eventBlocks, eventTime, isEventUrl, type MakeEvent } from '../../shared/events-core'
import { dayFromIso } from '../../shared/schedule-core'
import { formatDate, weekdayFull } from '../format'
import { useEvents } from '../events'
import { BOT_URL, haptic, openLink } from '../telegram'
import { Sheet } from './Sheet'
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

// Строка списка «Сервисы → Мероприятия ГУУ»: красным время и место, название, первое предложение описания
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
          📍 <span lang="ru">{event.place}</span>
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
            {t('Записаться')} ↗
          </button>
        )}
        {BOT_URL && (
          <button type="button" className="link-btn" onClick={() => (haptic(), openLink(`${BOT_URL}/event/${event.id}.ics`))}>
            🗓️ {t('В календарь')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

const openCommunity = () => (haptic(), openLink(EVENTS_COMMUNITY_URL))

// Текст, который нажимается, но переносится как обычный текст (кнопка переносилась бы целиком)
function InlineButton({ className, lang, onPress, children }: { className: string; lang?: string; onPress: () => void; children: ReactNode }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={className}
      lang={lang}
      onClick={() => (haptic(), onPress())}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPress()
      }}
    >
      {children}
    </span>
  )
}

// «10:40 «7 правил». Лекция о зарубежном автопроме и ещё 2»: нажатие на название — окно мероприятия,
// «и ещё 2» — остальные в это время
function ProjectLine({ time, events, onOpen }: { time: string; events: MakeEvent[]; onOpen: (e: MakeEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [first, ...rest] = events
  return (
    <p className="project-line">
      <b>{short(time)}</b>{' '}
      <InlineButton className="project-event" lang="ru" onPress={() => onOpen(first)}>
        {first.title}
      </InlineButton>
      {rest.length > 0 &&
        (open ? (
          rest.map((e) => (
            <span key={e.id}>
              {' · '}
              <InlineButton className="project-event" lang="ru" onPress={() => onOpen(e)}>
                {e.title}
              </InlineButton>
            </span>
          ))
        ) : (
          <>
            {' '}
            <InlineButton className="project-more" onPress={() => setOpen(true)}>
              {t('и ещё {n}', { n: rest.length })}
            </InlineButton>
          </>
        ))}
    </p>
  )
}

const onDay = (events: MakeEvent[] | null | 'error', iso: string) =>
  Array.isArray(events) ? events.filter((e) => e.start.startsWith(iso)) : events

// «Проектное обучение» — светло-красный блок в конце дня: время, мероприятия по времени начала, «Все мероприятия».
// from/to — пары «Проектного обучения» у группы (нет — весь день проектный).
export function ProjectDay({ iso, from, to, onAll }: { iso: string; from?: string; to?: string; onAll?: () => void }) {
  const all = useEvents()
  const events = onDay(all, iso)
  const [sheet, setSheet] = useState<MakeEvent | null>(null)
  const close = useCallback(() => setSheet(null), [])
  const count = Array.isArray(events) ? events.length : null

  return (
    <section className="callout project">
      <p className="project-title">🚀 {t('Проектное обучение')}</p>
      <p className="project-sub">
        {from && to ? `${short(from)}–${short(to)}` : t('Весь день')}
        {' · '}
        {count ? t('{events} на make.events', { events: countText(count) }) : 'make.events'}
      </p>
      {events === null ? (
        <p className="project-status">{t('Загружаю мероприятия…')}</p>
      ) : events === 'error' || !events.length ? (
        <p className="project-status">{events === 'error' ? t('Не удалось загрузить мероприятия. Проверьте интернет.') : t('Мероприятий на этот день пока нет')}</p>
      ) : (
        <div className="project-list">
          {eventBlocks(events).map((b) => (
            <ProjectLine key={b.time} time={b.time} events={b.events} onOpen={setSheet} />
          ))}
        </div>
      )}
      <button type="button" className="link-btn project-all" onClick={() => (onAll ? (haptic(), onAll()) : openCommunity())}>
        {t('Все мероприятия')}
      </button>
      {sheet && <EventSheet event={sheet} onClose={close} />}
    </section>
  )
}

export { countText as eventsCountText, dayTitle as eventDayTitle }
