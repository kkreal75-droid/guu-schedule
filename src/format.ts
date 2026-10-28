// Даты, длительности и плюралы на языке интерфейса (src/i18n.ts). Общее с ботом — shared/format-core.ts,
// сами даты — Intl (shared/i18n-core.ts).
import * as core from '../shared/format-core'
import { dateOf } from '../shared/format-core'
import { dayMonth, dayMonthShort, monthName, weekdayName } from '../shared/i18n-core'
import { getLang, t } from './i18n'

export { dateOf, formatStamp } from '../shared/format-core'

export const formatDate = (day: number) => core.formatDate(day, getLang())
export const formatFullDate = (day: number) => core.formatFullDate(day, getLang())
export const weekTitle = (week: number) => core.weekTitle(week, getLang())
export const pluralPairs = (n: number) => core.pluralPairs(n, getLang())

// «Среда» / «Wednesday», коротко «Ср» / «Wed» (0 = понедельник)
export const weekdayFull = (weekday: number) => weekdayName(weekday, getLang())
export const weekdayShort = (weekday: number) => weekdayName(weekday, getLang(), 'short')
// дни недели по порядку (0 = понедельник)
export const WEEK_INDEXES = [0, 1, 2, 3, 4, 5, 6]
// «Октябрь» / «October»
export const monthTitle = (month: number) => monthName(month, getLang())

// «19 – 25 октября» или «26 октября – 1 ноября» / «19 – 25 October»
export function formatRange(from: number, to: number) {
  const a = dateOf(from)
  const b = dateOf(to)
  return a.month === b.month ? `${a.date} – ${dayMonth(to, getLang())}` : `${dayMonth(from, getLang())} – ${dayMonth(to, getLang())}`
}

// неделя над днями, даты сессии: «19–25 октября» или «26 октября – 1 ноября» / «19–25 October»
export function formatDays(from: number, to: number) {
  const a = dateOf(from)
  const b = dateOf(to)
  return a.month === b.month ? `${a.date}–${dayMonth(to, getLang())}` : `${dayMonth(from, getLang())} – ${dayMonth(to, getLang())}`
}

// «Обновлено 25 октября в 10:32» — время по Москве; неразборчивая дата — null
export function formatUpdated(at: string | number): string | null {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const day = Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000
  const time = `${get('hour')}:${String(get('minute')).padStart(2, '0')}`
  return t('{date} в {time}', { date: formatDate(day), time })
}

// «9:00» вместо «09:00»: крупное время начала читается быстрее без ведущего нуля
export const shortTime = (time: string) => time.replace(/^0(\d)/, '$1')

// «10 мин», «1 ч 35 мин» / «10 min», «1 h 35 min»
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return t('{m} мин', { m })
  return m ? t('{h} ч {m} мин', { h, m }) : t('{h} ч', { h })
}

// «19 окт — 25 окт» / «19 Oct — 25 Oct»
export const formatShortRange = (from: number, to: number) => `${dayMonthShort(from, getLang())} — ${dayMonthShort(to, getLang())}`

// «20.11» / «20 Nov» — короткая дата в строках хода предмета
export const formatDayShort = (day: number) => {
  const d = dateOf(day)
  return getLang() === 'en' ? dayMonthShort(day, 'en') : `${String(d.date).padStart(2, '0')}.${String(d.month + 1).padStart(2, '0')}`
}

// Недели пары: «2–12, чётные», «1–13», «5, 7, 9–11» / «2–12, even»
export function weeksText(weeks: number[]): string {
  const list = [...new Set(weeks)].sort((a, b) => a - b)
  if (!list.length) return ''
  if (list.length === 1) return String(list[0])
  const step = list[1] - list[0]
  const regular = (step === 1 || step === 2) && list.every((w, i) => i === 0 || w - list[i - 1] === step)
  if (regular && list.length > 2) {
    const range = `${list[0]}–${list.at(-1)}`
    return step === 1 ? range : `${range}, ${list[0] % 2 === 0 ? t('чётные') : t('нечётные')}`
  }
  // подряд идущие — диапазоном
  const parts: string[] = []
  let from = list[0]
  let prev = list[0]
  for (const w of [...list.slice(1), Infinity]) {
    if (w === prev + 1) {
      prev = w
      continue
    }
    parts.push(from === prev ? String(from) : prev === from + 1 ? `${from}, ${prev}` : `${from}–${prev}`)
    from = prev = w
  }
  return parts.join(', ')
}
