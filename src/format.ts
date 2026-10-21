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

// «10 мин», «1 ч 35 мин» / «10 min», «1 h 35 min»
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return t('{m} мин', { m })
  return m ? t('{h} ч {m} мин', { h, m }) : t('{h} ч', { h })
}

// «19 окт — 25 окт» / «19 Oct — 25 Oct»
export const formatShortRange = (from: number, to: number) => `${dayMonthShort(from, getLang())} — ${dayMonthShort(to, getLang())}`
