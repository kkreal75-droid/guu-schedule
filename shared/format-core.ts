// Форматирование дат и недель — общее для мини-приложения и бота. lang — язык (по умолчанию русский),
// сами даты — через Intl (shared/i18n-core.ts).
import { dayMonth, dayMonthYear, pluralForm, type Lang } from './i18n-core'
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

// «21 октября» / «21 October»
export const formatDate = (day: number, lang: Lang = 'ru') => dayMonth(day, lang)

// «21 октября 2026» / «21 October 2026»
export const formatFullDate = (day: number, lang: Lang = 'ru') => dayMonthYear(day, lang)

export const isEvenWeek = (week: number) => week % 2 === 0

// «Чётная, 8-я неделя» / «Even week · Week 8»
export const weekTitle = (week: number, lang: Lang = 'ru') =>
  lang === 'en'
    ? `${isEvenWeek(week) ? 'Even' : 'Odd'} week · Week ${week}`
    : `${isEvenWeek(week) ? 'Чётная' : 'Нечётная'}, ${week}-я неделя`

// «1 пара / 2 пары / 5 пар» / «1 class / 2 classes»
export const pluralPairs = (n: number, lang: Lang = 'ru') =>
  `${n} ${pluralForm(lang, n, lang === 'en' ? 'class|classes' : 'пара|пары|пар')}`

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
