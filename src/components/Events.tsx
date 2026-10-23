import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EVENTS_COMMUNITY_URL, eventBlocks, eventTime, isEventUrl, type MakeEvent } from '../../shared/events-core'
import { dayFromIso } from '../../shared/schedule-core'
import { formatDate, weekdayFull } from '../format'
import { BoltIcon, BookIcon, CalendarIcon, ChevronDown, ChevronRight, ClockIcon, ExternalIcon, PinIcon } from '../icons'
import { useEvents } from '../events'
import { BOT_URL, haptic, openLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t, tn } from '../i18n'

// Мероприятия make.events (этап 13): карточка, блок «время начала → мероприятия», шторка, день «Проектного обучения».
// Названия и описания — от организаторов, по-русски (lang="ru"), только текстом.

const short = (time: string) => time.replace(/^0(\d)/, '$1')
// описание, повторяющее название («Роль классификаторов» / «Роль классификаторов»), не показываем
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const extraText = (event: MakeEvent) => (event.description && squash(event.description) !== squash(event.title) ? event.description : '')
const countText = (n: number) => `${n} ${tn(n, 'мероприятие|мероприятия|мероприятий')}`
const weekdayOf = (day: number) => (((day - 4) % 7) + 7) % 7 // 1970-01-01 — четверг; 0 = понедельник
const dayTitle = (iso: string) => {
  const day = dayFromIso(iso)
  return `${weekdayFull(weekdayOf(day))}, ${formatDate(day)}`
}

export function EventCard({ event, showTime, onOpen }: { event: MakeEvent; showTime?: boolean; onOpen: (e: MakeEvent) => void }) {
  return (
    <button type="button" className="event-card" onClick={() => (haptic(), onOpen(event))}>
      <span className="event-icon">
        <BoltIcon />
      </span>
      <span className="event-body">
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
        {extraText(event) && (
          <span className="event-desc" lang="ru">
            {extraText(event).replace(/\n+/g, ' ')}
          </span>
        )}
      </span>
      <ChevronRight className="event-chevron" />
    </button>
  )
}

// «10:40 · 6 мероприятий»: видно первое, «Ещё 5» раскрывает на месте
function EventBlock({ time, events, onOpen }: { time: string; events: MakeEvent[]; onOpen: (e: MakeEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [first, ...rest] = events
  return (
    <section className="event-block">
      <div className="event-block-head">
        <span className="event-block-time">{short(time)}</span>
        {events.length > 1 && <span className="badge event-count">{countText(events.length)}</span>}
      </div>
      <div className="event-list">
        <EventCard event={first} onOpen={onOpen} />
        {open && rest.map((e) => <EventCard key={e.id} event={e} onOpen={onOpen} />)}
      </div>
      {rest.length > 0 && (
        <button type="button" className="event-more" aria-expanded={open} onClick={() => (haptic(), setOpen((v) => !v))}>
          {open ? t('Свернуть') : t('Ещё {n}', { n: rest.length })}
          <ChevronDown className="event-more-icon" data-up={open || undefined} />
        </button>
      )}
    </section>
  )
}

export function EventSheet({ event, onClose }: { event: MakeEvent; onClose: () => void }) {
  useBackButton(onClose)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const start = short(eventTime(event.start))
  const end = event.end ? short(eventTime(event.end)) : null
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet event-sheet" role="dialog" aria-modal="true" aria-label={event.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head event-sheet-head">
          <span className="event-icon event-icon-lg">
            <BoltIcon />
          </span>
          <div className="sheet-heading">
            <div className="sheet-title" lang="ru">
              {event.title}
            </div>
            <div className="sheet-sub">{dayTitle(event.start.slice(0, 10))}</div>
          </div>
        </div>
        <div className="event-sheet-body">
          <div className="event-plaque">
            <ClockIcon /> {t('Начало: {time}', { time: start })}
            {end && ` — ${end}`}
          </div>
          {event.place && (
            <div className="event-place">
              <PinIcon /> <span lang="ru">{event.place}</span>
            </div>
          )}
          {extraText(event) && (
            <div className="event-text" lang="ru">
              {extraText(event).split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
        <div className="event-actions">
          {isEventUrl(event.url) && (
            <button type="button" className="event-btn event-btn-main" onClick={() => (haptic(), openLink(event.url))}>
              {t('Записаться')} <ExternalIcon />
            </button>
          )}
          {BOT_URL && (
            <button type="button" className="event-btn" onClick={() => (haptic(), openLink(`${BOT_URL}/event/${event.id}.ics`))}>
              <CalendarIcon /> {t('В календарь')}
            </button>
          )}
          <button type="button" className="event-btn" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const openCommunity = () => (haptic(), openLink(EVENTS_COMMUNITY_URL))

// Блоки дня; нет мероприятий — «пока нет» и ссылка на все
function DayEvents({ events, onOpen }: { events: MakeEvent[] | null | 'error'; onOpen: (e: MakeEvent) => void }) {
  if (events === null) return <p className="lead event-status">{t('Загружаю мероприятия…')}</p>
  if (events === 'error' || !events.length) {
    return (
      <div className="event-empty">
        <div className="event-empty-text">
          {events === 'error' ? t('Не удалось загрузить мероприятия. Проверьте интернет.') : t('Мероприятий на этот день пока нет')}
        </div>
        <button type="button" className="event-link" onClick={openCommunity}>
          {t('Все мероприятия')} <ExternalIcon />
        </button>
      </div>
    )
  }
  return (
    <>
      {eventBlocks(events).map((b) => (
        <EventBlock key={b.time} time={b.time} events={b.events} onOpen={onOpen} />
      ))}
    </>
  )
}

const onDay = (events: MakeEvent[] | null | 'error', iso: string) =>
  Array.isArray(events) ? events.filter((e) => e.start.startsWith(iso)) : events

// День, где все пары — «Проектное обучение»: вместо шести одинаковых карточек — шапка и мероприятия дня.
// folded — у группы в этот день свои пары (четверг МБ заменён): свёрнутая карточка под парами.
export function ProjectDay({ iso, folded, from, to }: { iso: string; folded?: boolean; from?: string; to?: string }) {
  const all = useEvents()
  const events = onDay(all, iso)
  const [sheet, setSheet] = useState<MakeEvent | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setSheet(null), [])
  const count = Array.isArray(events) ? events.length : null

  const body = (
    <>
      <DayEvents events={events} onOpen={setSheet} />
      {sheet && <EventSheet event={sheet} onClose={close} />}
    </>
  )
  if (folded) {
    return (
      <section className="project-fold" data-open={open || undefined}>
        <button type="button" className="project-head project-fold-head" aria-expanded={open} onClick={() => (haptic(), setOpen((v) => !v))}>
          <span className="project-icon">
            <BookIcon />
          </span>
          <span className="project-heading">
            <span className="project-title">
              {t('Мероприятия проектного обучения')}
              {count ? ` · ${count}` : ''}
            </span>
            <span className="project-caps">
              {from && to ? `${short(from)}–${short(to)} · ` : ''}Make.Events
            </span>
          </span>
          <ChevronDown className="project-fold-icon" data-up={open || undefined} />
        </button>
        {open && (
          <div className="project-fold-body">
            {body}
            {count ? (
              <button type="button" className="event-link" onClick={openCommunity}>
                {t('Все мероприятия')} <ExternalIcon />
              </button>
            ) : null}
          </div>
        )}
      </section>
    )
  }
  return (
    <>
      <section className="project-head">
        <span className="project-icon">
          <BookIcon />
        </span>
        <span className="project-heading">
          <span className="project-title">{t('Проектное обучение')}</span>
          <span className="project-caps">{t('Весь день')} · Make.Events</span>
        </span>
        <button type="button" className="project-all" onClick={openCommunity}>
          {t('Все')} <ExternalIcon />
        </button>
      </section>
      {body}
    </>
  )
}

export { countText as eventsCountText, dayTitle as eventDayTitle }
