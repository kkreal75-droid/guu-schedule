import { DAY_MS, isEvenWeek } from './schedule'

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const WEEKDAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
]

export function dateOf(day: number) {
  const d = new Date(day * DAY_MS)
  return { date: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() }
}

export const formatDate = (day: number) => {
  const { date, month } = dateOf(day)
  return `${date} ${MONTHS_GEN[month]}`
}

export const formatFullDate = (day: number) => {
  const { date, month, year } = dateOf(day)
  return `${date} ${MONTHS_GEN[month]} ${year}`
}

// «19 – 25 октября» или «26 октября – 1 ноября»
export function formatRange(from: number, to: number) {
  const a = dateOf(from)
  const b = dateOf(to)
  return a.month === b.month
    ? `${a.date} – ${b.date} ${MONTHS_GEN[b.month]}`
    : `${a.date} ${MONTHS_GEN[a.month]} – ${b.date} ${MONTHS_GEN[b.month]}`
}

export const weekTitle = (week: number) =>
  `${isEvenWeek(week) ? 'Чётная' : 'Нечётная'}, ${week}-я неделя`

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

export function pluralPairs(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} пара`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} пары`
  return `${n} пар`
}

// «19.10 12:06» по Москве; на неразборчивую дату — null
export function formatStamp(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`
}
