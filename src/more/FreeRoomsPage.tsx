import { useEffect, useMemo, useRef, useState } from 'react'
import { dataUrl, getTimetable, moscowNow, toMinutes } from '../schedule'
import { dateOf, shortTime, weekdayShort } from '../format'
import { loadPlacesFile, placeForRoom, type Place } from '../places'
import { haptic } from '../telegram'
import { getLang, t, tn } from '../i18n'
import { dayOffTitle } from '../../shared/schedule-core'

// rooms.json (update.py): аудитория → когда занята; weeks — битовая маска (бит N = N-я неделя)
type RoomsFile = { rooms: Record<string, { building: string; busy: [number, string, string, number][] }> }

// Пары ГУУ: дневные и вечерние (у ОЗФО, магистратуры, аспирантуры)
const SLOTS = [
  ['09:00', '10:30'],
  ['10:40', '12:10'],
  ['12:55', '14:25'],
  ['14:35', '16:05'],
  ['16:15', '17:45'],
  ['17:55', '19:25'],
  ['18:50', '20:20'],
  ['20:30', '22:00'],
] as const

// «ЛК-105/107» — две аудитории; «Спортивный комплекс», «ЦК ГУУ» — не аудитории для пар
function splitRoom(room: string): string[] {
  const m = room.match(/^([А-ЯЁ]{1,3})-(\d{2,4})(?:\/(\d{2,4}))?$/)
  if (!m) return []
  return m[3] ? [`${m[1]}-${m[2]}`, `${m[1]}-${m[3]}`] : [`${m[1]}-${m[2]}`]
}

const naturally = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true })
const inWeek = (mask: number, week: number) => Math.floor(mask / 2 ** week) % 2 === 1

// День по умолчанию — сегодня (в воскресенье — понедельник), пара — текущая или следующая
function defaults() {
  const { day, minutes } = moscowNow()
  const tt = getTimetable()
  let target = tt.weekdayOf(day) === 6 ? day + 1 : day
  let slot = SLOTS.findIndex(([, end]) => toMinutes(end) > minutes)
  if (target !== day) slot = 0
  if (slot < 0) {
    target += tt.weekdayOf(target + 1) === 6 ? 2 : 1
    slot = 0
  }
  return { day: target, slot }
}

export function FreeRoomsPage() {
  const [data, setData] = useState<RoomsFile | null>(null)
  const [error, setError] = useState(false)
  const [{ day, slot }, setChoice] = useState(defaults)
  // корпуса словами: «Лабораторный корпус · 24» (places.json)
  const [places, setPlaces] = useState<Place[]>([])
  useEffect(() => {
    loadPlacesFile().then(setPlaces, () => {})
  }, [])
  const buildingName = (prefix: string) => {
    const place = placeForRoom(places, `${prefix}-1`)
    return place ? (getLang() === 'en' ? (place.name_en ?? place.name) : place.name) : `${prefix}-…`
  }
  // выбранная пара по умолчанию может быть вечерней — прокручиваем ленту к ней
  const slotsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    slotsRef.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [data])
  useEffect(() => {
    fetch(dataUrl('rooms.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<RoomsFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData, () => setError(true))
  }, [])

  const tt = getTimetable()
  const today = moscowNow().day
  // ближайшие 7 учебных дней (без воскресений)
  const days = useMemo(() => {
    const out: number[] = []
    for (let d = today; out.length < 7; d++) if (tt.weekdayOf(d) !== 6) out.push(d)
    return out
  }, [today, tt])

  const result = useMemo(() => {
    if (!data) return null
    const week = tt.weekOf(day)
    const weekday = tt.weekdayOf(day)
    const [from, to] = SLOTS[slot].map(toMinutes)
    const all = new Set<string>()
    const busy = new Set<string>()
    for (const [room, info] of Object.entries(data.rooms)) {
      const names = splitRoom(room)
      names.forEach((n) => all.add(n))
      const taken = info.busy.some(
        ([wd, s, e, mask]) => wd === weekday && toMinutes(s) < to && toMinutes(e) > from && inWeek(mask, week),
      )
      if (taken) names.forEach((n) => busy.add(n))
    }
    const byBuilding = new Map<string, string[]>()
    for (const room of [...all].filter((r) => !busy.has(r)).sort(naturally)) {
      const building = room.split('-')[0]
      byBuilding.set(building, [...(byBuilding.get(building) ?? []), room])
    }
    return { total: all.size, free: [...byBuilding.entries()].sort(([a], [b]) => naturally(a, b)), inSemester: tt.inSemester(week) }
  }, [data, day, slot, tt])

  if (error) return <p className="lead">{t('Не получилось загрузить аудитории. Проверьте интернет.')}</p>
  if (!data || !result) return <p className="lead">{t('Загружаю аудитории…')}</p>

  const pick = (next: Partial<{ day: number; slot: number }>) => {
    haptic()
    setChoice((c) => ({ ...c, ...next }))
  }

  const free = result.free.reduce((n, [, rooms]) => n + rooms.length, 0)
  return (
    <>
      <p className="page-lead">{t('По расписанию ГУУ, без учёта мероприятий и замен.')}</p>
      <div className="rooms-picker" role="radiogroup" aria-label={t('День')}>
        {days.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={d === day} className="chip" onClick={() => pick({ day: d })}>
            {d === today ? t('Сегодня') : `${weekdayShort(tt.weekdayOf(d))} ${dateOf(d).date}`}
          </button>
        ))}
      </div>
      <div className="rooms-picker" role="radiogroup" aria-label={t('Пара')} ref={slotsRef}>
        {SLOTS.map(([start, end], i) => (
          <button
            key={start}
            type="button"
            role="radio"
            aria-checked={i === slot}
            aria-label={`${start}–${end}`}
            className="chip"
            onClick={() => pick({ slot: i })}
          >
            {shortTime(start)}
          </button>
        ))}
      </div>
      {tt.dayOff(day) ? (
        // выходной для всех (overrides.json → days_off) — пар нет, по расписанию аудитории не заняты
        <p className="lead rooms-message">{t('Выходной: {title}. Пар в этот день нет.', { title: dayOffTitle(tt.dayOff(day)!, getLang()) })}</p>
      ) : !result.inSemester ? (
        <p className="lead rooms-message">{t('Этот день вне учебного семестра.')}</p>
      ) : (
        <>
          <div className="rooms-count">
            <span className="rooms-free">{free}</span>
            <span className="rooms-total">{tn(result.total, 'из {n} аудитории свободны|из {n} аудиторий свободны|из {n} аудиторий свободны')}</span>
          </div>
          {result.free.map(([building, rooms]) => (
            <section key={building} className="section rooms-group">
              <h3 className="section-title">
                {buildingName(building)} · {rooms.length}
              </h3>
              <div className="rooms-list">
                {rooms.map((room) => (
                  <span key={room} className="chip room-chip" lang="ru">
                    {room}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  )
}
