import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, PinIcon, SearchIcon } from '../icons'
import {
  PLACE_GROUPS, howtoLines, loadCampus, loadPlaces, mapApps, placeForRoom, placeTitle, searchPlaces,
  type CampusMap as MapData, type Place, type PlaceGroup,
} from '../places'
import { haptic, openLink } from '../telegram'
import { CampusMap, onCampusMap } from './CampusMap'

// «Другое → Корпуса ГУУ» (этап 7.7): поиск, схема кампуса (корпуса нажимаются), места по группам
// «Корпуса / Спорт / Еда / Другое». Карточка раскрывается: схема с меткой у входа, «Как пройти», адрес,
// «Открыть в…» (Apple / Google / Яндекс / 2ГИС). Из пары (аудитория) и из «Спорта» — сразу нужная карточка.

export type PlacesTarget = { place?: string; room?: string }

const GROUP_COLOR: Record<PlaceGroup, string> = { buildings: 'green', sport: 'orange', food: 'amber', other: 'blue' }

export function PlacesPage({ target }: { target?: PlacesTarget }) {
  const [places, setPlaces] = useState<Place[] | null>(null)
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

  if (failed && !places) return <p className="gsearch-empty">Не получилось загрузить места. Проверь интернет.</p>
  if (!places) return <p className="gsearch-empty">Загружаю…</p>

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
      <label className="search-field">
        <SearchIcon />
        <input
          type="search"
          placeholder="Корпус, аудитория, столовая…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск места"
        />
      </label>

      {room && (
        <p className="places-room">
          {roomPlace ? (
            <>
              <b>{room}</b> — {placeTitle(roomPlace)}
            </>
          ) : (
            <>
              Не знаю, где аудитория <b>{room}</b>. Подскажи через «Другое → Написать в поддержку».
            </>
          )}
        </p>
      )}

      {!query.trim() && map && (
        <section className="places-overview">
          <CampusMap map={map} places={places} onPick={pick} />
          <p className="places-overview-hint">Рязанский проспект, 99 · метро «Выхино». Нажми на корпус — откроется карточка.</p>
        </section>
      )}

      {found.length === 0 && <p className="gsearch-empty">Ничего не нашёл. Попробуй «столовая», «ЛК» или «У-432».</p>}

      {PLACE_GROUPS.map((g) => {
        const items = found.filter((p) => p.group === g.id)
        if (!items.length) return null
        return (
          <section key={g.id} className="other-group places-group">
            <h3 className="other-group-title">{g.title}</h3>
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
          </section>
        )
      })}

      <p className="places-footer">
        Адреса и схема — по данным guu.ru и OpenStreetMap. Нашёл ошибку или нет нужного места — напиши в «Другое → Написать в поддержку».
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
      <button type="button" className="other-row place-row" onClick={onToggle} aria-expanded={open}>
        <span className={`other-icon place-icon ic-${GROUP_COLOR[p.group]}`} aria-hidden>
          {p.icon}
        </span>
        <span className="other-text">
          <span className="other-title">{placeTitle(p)}</span>
          {!open && p.address && <span className="other-sub">{p.address}</span>}
        </span>
        <ChevronRight className="other-chevron place-chevron" />
      </button>
      {open && (
        <div className="place-body">
          {map && onCampusMap(map, p) && <CampusMap map={map} places={places} focus={p} />}
          {room && <p className="place-room-line">{/\d/.test(room) ? `Аудитория ${room}` : room}</p>}
          {lines.length > 0 && (
            <div className="place-howto">
              <h4>Как пройти</h4>
              <ul>
                {lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {p.address && (
            <p className="place-address">
              <PinIcon /> {p.address}
            </p>
          )}
          {p.note && <p className="place-note">{p.note}</p>}
          <button type="button" className="button-primary place-open" onClick={() => (haptic(), openLink(apps[0].url))}>
            Открыть в {apps[0].title.replace(' Карты', ' Картах')}
          </button>
          <div className="place-apps">
            {apps.slice(1).map((app) => (
              <button key={app.id} type="button" className="place-app" onClick={() => (haptic(), openLink(app.url))} aria-label={app.title}>
                {app.short}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
