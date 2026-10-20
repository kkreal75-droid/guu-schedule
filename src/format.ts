import { MONTHS_GEN, dateOf } from '../shared/format-core'

// Общее с ботом — в shared/format-core.ts
export {
  WEEKDAYS_FULL, WEEKDAYS_SHORT, dateOf, formatDate, formatFullDate, formatStamp, pluralPairs, weekTitle,
} from '../shared/format-core'

// «19 – 25 октября» или «26 октября – 1 ноября»
export function formatRange(from: number, to: number) {
  const a = dateOf(from)
  const b = dateOf(to)
  return a.month === b.month
    ? `${a.date} – ${b.date} ${MONTHS_GEN[b.month]}`
    : `${a.date} ${MONTHS_GEN[a.month]} – ${b.date} ${MONTHS_GEN[b.month]}`
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

// «19 окт — 25 окт»
export function formatShortRange(from: number, to: number) {
  const a = dateOf(from)
  const b = dateOf(to)
  return `${a.date} ${MONTHS_SHORT[a.month]} — ${b.date} ${MONTHS_SHORT[b.month]}`
}
