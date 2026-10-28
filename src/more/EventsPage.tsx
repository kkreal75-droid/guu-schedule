import { useCallback, useMemo, useState } from 'react'
import { EVENTS_COMMUNITY_URL, eventDay, type MakeEvent } from '../../shared/events-core'
import { isoFromDay } from '../../shared/schedule-core'
import { EventCard, EventSheet, eventDayTitle } from '../components/Events'
import { SearchField } from '../components/SearchField'
import { Section } from '../components/Section'
import { useEvents } from '../events'
import { moscowNow } from '../schedule'
import { haptic, openLink } from '../telegram'
import { t } from '../i18n'
import { Icon } from '../icons'

// «Сервисы → Мероприятия ГУУ» (этап 13): все предстоящие мероприятия проектного обучения с make.events по датам,
// поиск по названию, месту и описанию. Нажатие — окно снизу с «Записаться» и «В календарь».
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
      <p className="page-lead">{t('Клубы, лекции и мастер-классы с make.events.')}</p>
      <SearchField
        value={query}
        onChange={(v) => (setQuery(v), setLimit(PAGE_DAYS))}
        placeholder={t('Название, место, тема')}
        label={t('Поиск мероприятий')}
      />
      {all === null && <p className="lead event-status">{t('Загружаю мероприятия…')}</p>}
      {all === 'error' && <p className="lead event-status">{t('Не удалось загрузить мероприятия. Проверьте интернет.')}</p>}
      {Array.isArray(all) && !days.length && (
        <p className="lead event-status">{query ? t('Ничего не нашлось') : t('Предстоящих мероприятий пока нет')}</p>
      )}
      {days.slice(0, limit).map(([iso, list]) => (
        <Section key={iso} title={`${eventDayTitle(iso)} · ${list.length}`}>
          {list.map((e) => (
            <EventCard key={e.id} event={e} showTime onOpen={setSheet} />
          ))}
        </Section>
      ))}
      {days.length > limit && (
        <button type="button" className="button-secondary" onClick={() => (haptic(), setLimit((n) => n + PAGE_DAYS))}>
          {t('Показать ещё')}
        </button>
      )}
      <button type="button" className="button-secondary" onClick={() => (haptic(), openLink(EVENTS_COMMUNITY_URL))}>
        {t('Все мероприятия на make.events')}
        <Icon name="arrow-up-right" size={18} strokeWidth={1.8} />
      </button>
      {sheet && <EventSheet event={sheet} onClose={close} />}
    </div>
  )
}
