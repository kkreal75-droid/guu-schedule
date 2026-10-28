import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Icon, type IconName } from '../icons'
import { SearchField } from '../components/SearchField'
import {
  PLACE_GROUPS, placeGroupTitle, howtoLines, localPlace, loadCampus, loadPlaces, mapApps, placeForRoom, placeTitle, searchPlaces,
  type CampusMap as MapData, type Place,
} from '../places'
import { haptic, openLink } from '../telegram'
import { CampusMap, onCampusMap } from './CampusMap'
import { t, useLang } from '../i18n'

// «Сервисы → Корпуса ГУУ» (этап 7.7): поиск, схема кампуса без рамки (корпуса нажимаются), адрес и метро
// строкой под ней, места списками по группам «Корпуса / Спорт / Еда / Другое» с тонкими иконками. Строка раскрывается:
// схема с меткой у входа, «Как пройти», адрес, «Открыть в…» (Apple / Google / Яндекс / 2ГИС). Из пары
// (аудитория) — сразу карточка корпуса.

export type PlacesTarget = { place?: string; room?: string }

// иконка места по группе
const PLACE_ICON: Record<string, IconName> = { buildings: 'building', sport: 'dumbbell', food: 'cup', other: 'map-pin' }

export function PlacesPage({ target }: { target?: PlacesTarget }) {
  const lang = useLang()
  const [rawPlaces, setPlaces] = useState<Place[] | null>(null)
  // на языке интерфейса: по-английски — английские названия, адреса и «Как пройти»
  const places = useMemo(() => rawPlaces?.map(localPlace) ?? null, [rawPlaces, lang])
  const [map, setMap] = useState<MapData | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(target?.place ?? null)
  const cards = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    loadPlaces().then(setPlaces, () => setFailed(true))
    loadCampus().then(setMap, () => setMap(null))
  }, [])

  // пришли по аудитории («ЛК-405») — корпус по префиксу
  const roomPlace = useMemo(
    () => (places && target?.room ? placeForRoom(places, target.room) : null),
    [places, target?.room],
  )
  useEffect(() => {
    if (roomPlace) setOpenId(roomPlace.id)
  }, [roomPlace])

  // открытую извне карточку — в видимую область
  const scrollTo = (id: string) =>
    requestAnimationFrame(() => cards.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  const targetId = roomPlace?.id ?? target?.place
  useEffect(() => {
    if (places && targetId) scrollTo(targetId)
  }, [places, targetId])

  // «Спортивный комплекс» в паре — это и есть место: подсказка «аудитория → корпус» не нужна
  const room = target?.room && roomPlace?.name.toLowerCase() === target.room.trim().toLowerCase() ? undefined : target?.room
  const found = useMemo(() => (places ? searchPlaces(places, query) : []), [places, query])

  if (failed && !places) return <p className="gsearch-empty">{t('Не получилось загрузить места. Проверь интернет.')}</p>
  if (!places) return <p className="gsearch-empty">{t('Загружаю…')}</p>

  const toggle = (id: string) => {
    haptic()
    setOpenId((cur) => (cur === id ? null : id))
  }
  const pick = (p: Place) => {
    setOpenId(p.id)
    scrollTo(p.id)
  }

  return (
    <div className="places-page">
      <SearchField value={query} onChange={setQuery} placeholder={t('Корпус, аудитория, столовая')} label={t('Поиск места')} />

      {room && (
        <p className="places-room">
          {roomPlace ? (
            <>
              <b lang="ru">{room}</b> — {placeTitle(roomPlace)}
            </>
          ) : (
            <>
              {t('Не знаю, где аудитория {room}. Подскажи через «Сервисы → Написать в поддержку».', { room })}
            </>
          )}
        </p>
      )}

      {!query.trim() && map && (
        <section className="places-overview">
          <CampusMap map={map} places={places} onPick={pick} />
          <p className="section-footer places-overview-hint">{t('Рязанский проспект, 99 · метро «Выхино». © OpenStreetMap')}</p>
        </section>
      )}

      {found.length === 0 && <p className="gsearch-empty">{t('Ничего не нашёл. Попробуй «столовая», «ЛК» или «У-432».')}</p>}

      {PLACE_GROUPS.map((id) => {
        const items = found.filter((p) => p.group === id)
        if (!items.length) return null
        return (
          <section key={id} className="section places-group">
            <h3 className="section-title">{placeGroupTitle(id)}</h3>
            <div className="list">
            {items.map((p) => (
              <PlaceCard
                key={p.id}
                place={p}
                map={map}
                places={places}
                open={openId === p.id}
                room={roomPlace?.id === p.id ? room : undefined}
                onToggle={() => toggle(p.id)}
                cardRef={(el) => (el ? cards.current.set(p.id, el) : cards.current.delete(p.id))}
              />
            ))}
            </div>
          </section>
        )
      })}

      <p className="section-footer places-footer">
        {t('Адреса и схема — по данным guu.ru и OpenStreetMap. Нашёл ошибку или нет нужного места — напиши в «Сервисы → Написать в поддержку».')}
      </p>
    </div>
  )
}

type CardProps = {
  place: Place
  map: MapData | null
  places: Place[]
  open: boolean
  room?: string
  onToggle: () => void
  cardRef: (el: HTMLElement | null) => void
}

function PlaceCard({ place: p, map, places, open, room, onToggle, cardRef }: CardProps) {
  const apps = mapApps(p)
  const lines = howtoLines(p.howto)
  return (
    <div className="place-card" ref={cardRef} data-open={open || undefined}>
      <button type="button" className="row row-btn place-row" onClick={onToggle} aria-expanded={open}>
        <span className="row-icon">
          <Icon name={PLACE_ICON[p.group] ?? 'map-pin'} />
        </span>
        <span className="row-label">
          <span className="row-text">
            {p.name}
            {p.short && (
              <>
                {' ('}
                <span lang="ru">{p.short}</span>)
              </>
            )}
          </span>
          {!open && p.address && <span className="row-sub">{p.address}</span>}
        </span>
        <ChevronRight className="row-chevron place-chevron" />
      </button>
      {open && (
        <div className="place-body">
          {map && onCampusMap(map, p) && <CampusMap map={map} places={places} focus={p} />}
          {room && <p className="place-room-line">{/\d/.test(room) ? t('Аудитория {room}', { room }) : room}</p>}
          {lines.length > 0 && (
            <div className="place-howto">
              <h4>{t('Как пройти')}</h4>
              <ul>
                {lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {p.address && (
            <p className="place-address">
              <Icon name="map-pin" size={17} />
              <span>{p.address}</span>
            </p>
          )}
          {p.note && <p className="place-note">{p.note}</p>}
          <button type="button" className="button-primary place-open" onClick={() => (haptic(), openLink(apps[0].url))}>
            {apps[0].open}
          </button>
          <div className="place-apps">
            {apps.slice(1).map((app) => (
              <button key={app.id} type="button" className="link-btn place-app" onClick={() => (haptic(), openLink(app.url))} aria-label={app.title}>
                {app.short}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
