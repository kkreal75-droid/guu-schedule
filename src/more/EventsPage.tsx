import { useCallback, useMemo, useState } from 'react'
import { EVENTS_COMMUNITY_URL, eventDay, type MakeEvent } from '../../shared/events-core'
import { isoFromDay } from '../../shared/schedule-core'
import { EventCard, EventSheet, eventDayTitle, eventsCountText } from '../components/Events'
import { Section } from '../components/Section'
import { useEvents } from '../events'
import { ExternalIcon, SearchIcon } from '../icons'
import { moscowNow } from '../schedule'
import { haptic, openLink } from '../telegram'
import { t } from '../i18n'

// «Другое → Мероприятия ГУУ» (этап 13): все предстоящие мероприятия проектного обучения с make.events по датам,
// поиск по названию, месту и описанию. Нажатие — шторка с «Записаться» и «В календарь».
const PAGE_DAYS = 14 // дней с мероприятиями на экране; дальше — «Показать ещё»

const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е') // i18n-ignore: поиск по русскому тексту

export function EventsPage() {
  const all = useEvents()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_DAYS)
  const [sheet, setSheet] = useState<MakeEvent | null>(null)
  const close = useCallback(() => setSheet(null), [])

  const days = useMemo(() => {
    if (!Array.isArray(all)) return []
    const today = isoFromDay(moscowNow().day)
    const words = norm(query).split(/\s+/).filter(Boolean)
    const byDay = new Map<string, MakeEvent[]>()
    for (const e of [...all].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))) {
      if (eventDay(e) < today) continue
      const text = norm(`${e.title} ${e.place ?? ''} ${e.description}`)
      if (!words.every((w) => text.includes(w))) continue
      byDay.set(eventDay(e), [...(byDay.get(eventDay(e)) ?? []), e])
    }
    return [...byDay]
  }, [all, query])

  return (
    <div className="events-page">
      <p className="lead">{t('Проектное обучение: клубы, лекции, мастер-классы. Данные — с make.events, обновляются каждый час.')}</p>
      <label className="search-field">
        <SearchIcon />
        <input
          type="search"
          placeholder={t('Название, место, тема…')}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setLimit(PAGE_DAYS))}
          aria-label={t('Поиск мероприятий')}
        />
      </label>
      {all === null && <p className="lead event-status">{t('Загружаю мероприятия…')}</p>}
      {all === 'error' && <p className="lead event-status">{t('Не удалось загрузить мероприятия. Проверьте интернет.')}</p>}
      {Array.isArray(all) && !days.length && (
        <p className="lead event-status">{query ? t('Ничего не нашлось') : t('Предстоящих мероприятий пока нет')}</p>
      )}
      {days.slice(0, limit).map(([iso, list]) => (
        <Section key={iso} title={`${eventDayTitle(iso)} · ${eventsCountText(list.length)}`}>
          <div className="event-list">
            {list.map((e) => (
              <EventCard key={e.id} event={e} showTime onOpen={setSheet} />
            ))}
          </div>
        </Section>
      ))}
      {days.length > limit && (
        <button type="button" className="event-more" onClick={() => (haptic(), setLimit((n) => n + PAGE_DAYS))}>
          {t('Показать ещё')}
        </button>
      )}
      <button type="button" className="event-link events-page-all" onClick={() => (haptic(), openLink(EVENTS_COMMUNITY_URL))}>
        {t('Все мероприятия на make.events')} <ExternalIcon />
      </button>
      {sheet && <EventSheet event={sheet} onClose={close} />}
    </div>
  )
}
