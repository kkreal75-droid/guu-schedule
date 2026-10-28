import { useMemo } from 'react'
import { toMap, type CampusMap as MapData, type Place } from '../places'
import { haptic, openLink } from '../telegram'
import { t } from '../i18n'

// Схема кампуса ГУУ в цветах темы (данные — data/campus.json из OpenStreetMap, scripts/campus_map.py).
// Без focus — весь кампус, корпуса нажимаются; с focus — превью вокруг места с меткой у входа.

type Props = {
  map: MapData
  places: Place[]
  focus?: Place | null
  onPick?: (place: Place) => void
  className?: string
}

const FOCUS_WIDTH = 240 // метров по ширине превью
const ASPECT = 10 / 16 // высота / ширина (как в CSS)

// центр многоугольника (по площади); у вогнутых корпусов может оказаться во дворе — для подписи это не страшно
function centroid(d: string): [number, number] {
  const n = d.replace(/[MZ]/g, ' ').trim().split(/\s+/).map(Number)
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < n.length; i += 2) {
    const j = (i + 2) % n.length
    const cross = n[i] * n[j + 1] - n[j] * n[i + 1]
    a += cross
    cx += (n[i] + n[j]) * cross
    cy += (n[i + 1] + n[j + 1]) * cross
  }
  if (Math.abs(a) < 1e-6) return [n[0], n[1]]
  return [cx / (3 * a), cy / (3 * a)]
}

function boxOf(paths: string[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const d of paths) {
    const n = d.replace(/[MZ]/g, ' ').trim().split(/\s+/).map(Number)
    for (let i = 0; i < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i])
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1])
    }
  }
  return [x0, y0, x1, y1]
}

// место есть на схеме (кастомное место из админки может быть где угодно)
export function onCampusMap(map: MapData, p: Pick<Place, 'lat' | 'lon'>): boolean {
  const [x, y] = toMap(map, p.lat, p.lon)
  const [x0, y0, x1, y1] = map.bounds
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

const ROAD_WIDTH = [2.5, 4, 5.5, 7] // w из campus.json: 0 — проезд, 1 — улица, 2 — дублёр, 3 — проспект

export function CampusMap({ map, places, focus, onPick, className }: Props) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])
  // подписи: корпуса и спорт — сокращением (без сокращения — без подписи), проходная — мелко «КПП»; общежития без подписи
  const labels = useMemo(
    () =>
      map.buildings
        .filter((b) => b.place && byId.has(b.place))
        .map((b) => ({ place: byId.get(b.place!)!, at: centroid(b.d) }))
        .filter(({ place }) => ((place.group === 'buildings' || place.group === 'sport') && place.short) || place.id === 'kpp')
        // у проходной два здания — подпись одна
        .filter((l, i, all) => all.findIndex((o) => o.place.id === l.place.id) === i),
    [map, byId],
  )

  const view = useMemo(() => {
    if (focus) {
      const [x, y] = toMap(map, focus.lat, focus.lon)
      const w = FOCUS_WIDTH
      const h = w * ASPECT
      return [x - w / 2, y - h * 0.55, w, h] // метка чуть ниже центра — над ней видно здание
    }
    const [x0, y0, x1, y1] = boxOf(map.campus)
    const pad = 22
    const w = x1 - x0 + 2 * pad
    const h = Math.max(y1 - y0 + 2 * pad, w * 0.8)
    return [x0 - pad, (y0 + y1) / 2 - h / 2, w, h]
  }, [map, focus])
  const [vx, vy, vw, vh] = view
  const fs = vw / 24 // подписи ~14 px при любой ширине
  const pin = focus ? toMap(map, focus.lat, focus.lon) : null
  const metro = !focus ? byId.get('metro') : null

  return (
    <div className={`campus-map ${focus ? 'campus-map-focus' : 'campus-map-full'} ${className ?? ''}`}>
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={focus ? t('Схема: {name}', { name: focus.name }) : t('Схема кампуса ГУУ')}
      >
        <rect x={map.bounds[0] - 400} y={map.bounds[1] - 400} width={map.bounds[2] - map.bounds[0] + 800} height={map.bounds[3] - map.bounds[1] + 800} className="cm-bg" />
        {map.campus.map((d, i) => <path key={i} d={d} className="cm-campus" />)}
        {map.green.map((d, i) => <path key={i} d={d} className="cm-green" />)}
        {map.roads.map((r, i) => (
          <path key={i} d={r.d} className="cm-road" strokeWidth={ROAD_WIDTH[r.w] ?? 2.5} vectorEffect="non-scaling-stroke" />
        ))}
        {map.rail.map((d, i) => <path key={i} d={d} className="cm-rail" vectorEffect="non-scaling-stroke" />)}
        {map.paths.map((d, i) => <path key={i} d={d} className="cm-path" vectorEffect="non-scaling-stroke" />)}
        {map.buildings.map((b, i) => {
          const place = b.place ? byId.get(b.place) : undefined
          const cls = place && focus?.id === place.id ? 'cm-building cm-focus' : b.place || b.uni ? 'cm-building cm-uni' : 'cm-building'
          return onPick && place ? (
            <path
              key={i}
              d={b.d}
              className={`${cls} cm-tap`}
              onClick={() => (haptic(), onPick(place))}
              vectorEffect="non-scaling-stroke"
            >
              <title>{place.name}</title>
            </path>
          ) : (
            <path key={i} d={b.d} className={cls} vectorEffect="non-scaling-stroke" />
          )
        })}
        {labels.map(({ place, at }) => {
          const kpp = place.id === 'kpp'
          const text = kpp ? t('КПП') : place.short
          return (
            <text
              key={place.id}
              x={at[0]}
              y={at[1]}
              fontSize={kpp ? fs * 0.62 : fs}
              strokeWidth={fs * 0.22}
              className={focus?.id === place.id ? 'cm-label cm-label-focus' : 'cm-label'}
              onClick={onPick ? () => (haptic(), onPick(place)) : undefined}
              lang={kpp ? undefined : 'ru'}
            >
              {text}
            </text>
          )
        })}
        {/* метро — красный круг с «М» */}
        {metro && (
          <g transform={`translate(${toMap(map, metro.lat, metro.lon).join(' ')})`} className="cm-metro">
            <circle r={fs * 0.62} />
            {/* i18n-ignore — знак метро */}
            <text fontSize={fs * 0.78}>{'М'}</text>
          </g>
        )}
        {pin && (
          <g transform={`translate(${pin[0]} ${pin[1]}) scale(${vw / 300})`} className="cm-pin">
            <path d="M0 0C-1.6-4.6-9-9.2-9-15.6a9 9 0 0 1 18 0C9-9.2 1.6-4.6 0 0z" />
            <circle cx="0" cy="-15.6" r="3.6" />
          </g>
        )}
      </svg>
      <button
        type="button"
        className="cm-credit"
        onClick={(e) => (e.stopPropagation(), openLink('https://www.openstreetmap.org/copyright'))}
      >
        © OpenStreetMap
      </button>
    </div>
  )
}
