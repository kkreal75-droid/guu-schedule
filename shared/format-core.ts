// Форматирование дат и недель по-русски — общее для мини-приложения и бота.
import { DAY_MS } from './schedule-core'

export const MONTHS_GEN = [
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

export const isEvenWeek = (week: number) => week % 2 === 0

export const weekTitle = (week: number) => `${isEvenWeek(week) ? 'Чётная' : 'Нечётная'}, ${week}-я неделя`

export function pluralPairs(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} пара`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} пары`
  return `${n} пар`
}

// «19.10 12:06» по Москве; на неразборчивую дату — null
export function formatStamp(at: string | number): string | null {
  const date = new Date(at)
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
