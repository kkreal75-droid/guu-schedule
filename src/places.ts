// «Корпуса ГУУ» (этап 7.7): места кампуса из data/places.json + правки владельца из админки (D1, GET /places
// у бота) и схема кампуса data/campus.json (scripts/campus_map.py, OpenStreetMap).
import { cachedList } from './data'
import { readLocal, writeLocal } from './storage'
import { BOT_URL, inTelegram, tg } from './telegram'

export type PlaceGroup = 'buildings' | 'sport' | 'food' | 'other'
export const PLACE_GROUPS: { id: PlaceGroup; title: string }[] = [
  { id: 'buildings', title: 'Корпуса' },
  { id: 'sport', title: 'Спорт' },
  { id: 'food', title: 'Еда' },
  { id: 'other', title: 'Другое' },
]

export type Place = {
  id: string
  group: PlaceGroup
  short: string | null // «ЛК»
  name: string
  icon: string // эмодзи
  address: string
  lat: number // точка входа
  lon: number
  rooms: string[] // префиксы аудиторий («ЛК» → ЛК-405) или названия целиком («Актовый зал»)
  aliases: string[] // для поиска
  howto: string // «Как пройти»: строка — пункт
  note: string | null
  todo: string | null // что не проверено — видит только владелец в админке
  custom?: boolean // добавлено в админке
  edited?: boolean // файл поправлен в админке
}

export type PlaceEdit = { id: string; data: Partial<Place> & { hidden?: boolean }; updated_at: number }
type PlacesFile = { updated_at: string; places: Place[] }

const loadFile = cachedList<PlacesFile>('places.json', 'places_file')

// правки из админки: копия в localStorage — без сети покажем последние известные
const EDITS_KEY = 'places_edits'
let fresh = false
async function loadEdits(): Promise<PlaceEdit[]> {
  const saved = (() => {
    try {
      return JSON.parse(readLocal(EDITS_KEY) ?? '[]') as PlaceEdit[]
    } catch {
      return []
    }
  })()
  if (!BOT_URL) return saved
  try {
    // после правки в админке — мимо кэша браузера (ответ кэшируется на минуту)
    const res = await fetch(`${BOT_URL}/places`, fresh ? { cache: 'no-store' } : {})
    fresh = false
    if (!res.ok) return saved
    const data = (await res.json()) as { edits: PlaceEdit[] }
    writeLocal(EDITS_KEY, JSON.stringify(data.edits))
    return data.edits
  } catch {
    return saved
  }
}

export function mergePlaces(file: Place[], edits: PlaceEdit[]): Place[] {
  const byId = new Map(edits.map((e) => [e.id, e.data]))
  const out: Place[] = []
  for (const p of file) {
    const edit = byId.get(p.id)
    if (edit?.hidden) continue
    out.push(edit ? { ...p, ...edit, id: p.id, edited: true } : p)
  }
  for (const e of edits) {
    if (file.some((p) => p.id === e.id) || e.data.hidden) continue
    const d = e.data
    if (!d.name || typeof d.lat !== 'number' || typeof d.lon !== 'number') continue
    out.push({
      group: 'other', short: null, icon: '📍', address: '', rooms: [], aliases: [], howto: '', note: null, todo: null,
      ...d, id: e.id, name: d.name, lat: d.lat, lon: d.lon, custom: true,
    })
  }
  return out
}

let placesPromise: Promise<Place[]> | null = null
export function loadPlaces(): Promise<Place[]> {
  return (placesPromise ??= Promise.all([loadFile(), loadEdits()])
    .then(([file, edits]) => mergePlaces(file.places, edits))
    .catch((err) => {
      placesPromise = null
      throw err
    }))
}

// владелец поправил место в админке — в «Корпусах» перечитать
export function forgetPlaces() {
  placesPromise = null
  fresh = true
}

export const loadPlacesFile = () => loadFile().then((f) => f.places)

const squash = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim()

// ---------- аудитория → корпус ----------
// «ЛК-405» → место с префиксом «ЛК»; «Актовый зал», «Спортивный комплекс» — по названию целиком
export function roomPrefix(room: string): string {
  return room.trim().split(/[-–\s]/)[0]
}

export function placeForRoom(places: Place[], room: string): Place | null {
  const text = room.trim().toLowerCase()
  const prefix = roomPrefix(room).toLowerCase()
  return (
    places.find((p) => p.rooms.some((r) => r.toLowerCase() === text)) ??
    places.find((p) => p.rooms.some((r) => r.toLowerCase() === prefix)) ??
    null
  )
}

// номер аудитории: «У-432» → «432» (этаж не обещаем — не проверено, см. todo в places.json)
export const roomNumber = (room: string) => room.match(/[-–]\s*(\S+)$/)?.[1] ?? null

// ---------- поиск ----------

export function searchPlaces(places: Place[], query: string): Place[] {
  const q = squash(query)
  if (!q) return places
  // «у-432», «лк 405» — сначала корпус аудитории
  const byRoom = /\d/.test(query) ? placeForRoom(places, query) : null
  const hits = places.filter((p) => {
    const hay = squash([p.name, p.short ?? '', p.address, ...p.aliases, ...p.rooms].join(' '))
    return q.split(' ').every((w) => hay.includes(w))
  })
  return byRoom ? [byRoom, ...hits.filter((p) => p !== byRoom)] : hits
}

export const placeTitle = (p: Pick<Place, 'name' | 'short'>) => (p.short ? `${p.name} (${p.short})` : p.name)

export const howtoLines = (howto: string) =>
  howto
    .split('\n')
    .map((line) => line.replace(/^[-•·]\s*/, '').trim())
    .filter(Boolean)

// ---------- «Открыть в…» ----------
export type MapApp = { id: 'apple' | 'google' | 'yandex' | '2gis'; title: string; short: string; url: string }

const platform = (): 'ios' | 'android' | 'other' => {
  const p = inTelegram ? tg!.platform : ''
  if (p === 'ios' || (!inTelegram && /iPhone|iPad|iPod/.test(navigator.userAgent))) return 'ios'
  if (p.startsWith('android') || (!inTelegram && /Android/.test(navigator.userAgent))) return 'android'
  return 'other'
}

// На iOS первыми — Apple Карты, на Android (и на компьютере) — Google; Яндекс и 2ГИС — всегда
export function mapApps(p: Pick<Place, 'lat' | 'lon' | 'name'>): MapApp[] {
  const { lat, lon } = p
  const apple: MapApp = { id: 'apple', title: 'Apple Карты', short: 'Apple', url: `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(p.name)}` }
  const google: MapApp = { id: 'google', title: 'Google Карты', short: 'Google', url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` }
  const yandex: MapApp = { id: 'yandex', title: 'Яндекс Карты', short: 'Яндекс', url: `https://yandex.ru/maps/?pt=${lon},${lat}&z=18&l=map` }
  const gis: MapApp = { id: '2gis', title: '2ГИС', short: '2ГИС', url: `https://2gis.ru/geo/${lon},${lat}` }
  return platform() === 'ios' ? [apple, yandex, gis, google] : [google, yandex, gis, apple]
}

// ---------- схема кампуса ----------
export type CampusMap = {
  source: string
  origin: { lat: number; lon: number; mx: number; my: number }
  bounds: [number, number, number, number]
  campus: string[]
  green: string[]
  roads: { d: string; w: number }[]
  paths: string[]
  rail: string[]
  buildings: { d: string; place?: string; uni?: 1 }[]
}

export const loadCampus = cachedList<CampusMap>('campus.json', 'campus_map')

// широта/долгота → метры схемы
export const toMap = (m: CampusMap, lat: number, lon: number): [number, number] => [
  (lon - m.origin.lon) * m.origin.mx,
  -(lat - m.origin.lat) * m.origin.my,
]
