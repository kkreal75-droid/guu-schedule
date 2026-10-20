// «Спорт» (этап 7.4): секции и занятия — общее для приложения и бота. Недели занятия: '' — каждую,
// 'even' / 'odd' — чётные / нечётные, «1-8,10» — перечисление (как в расписании ГУУ).
import { isEvenWeek } from './format-core'

export type SportSection = {
  id: number
  name: string
  emoji: string | null
  teacher: string | null
  place: string | null
  place_id: string | null
  about: string | null
  sort: number
}

export type SportSession = {
  id: number
  section_id: number
  weekday: number // 0 — понедельник
  start: string
  end: string
  weeks: string
  teacher: string | null // null — как у секции
  place: string | null
}

export type SportData = { sections: SportSection[]; sessions: SportSession[]; updated_at: number | null }

const RANGE = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*$/

// null — спецификация непонятна
export function weeksProblem(spec: string): string | null {
  const s = spec.trim().toLowerCase()
  if (!s || s === 'even' || s === 'odd') return null
  for (const part of s.split(',')) {
    const m = part.match(RANGE)
    if (!m) return `Недели: «${spec}» — пишите «1-8,10», «чёт», «нечёт» или оставьте пустым`
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b > 52 || a > b) return `Недели: «${part.trim()}» вне 1–52`
  }
  return null
}

// «чёт» / «нечёт» / «по чётным» → even / odd; остальное как есть
export function normalizeWeeks(spec: string): string {
  const s = spec.trim().toLowerCase().replace(/\s+/g, '')
  if (!s || /^(каждую|все|всенедели|-)$/.test(s)) return ''
  if (/^(even|чёт|чет|чётные|четные|почётным|почетным|ч)$/.test(s)) return 'even'
  if (/^(odd|нечёт|нечет|нечётные|нечетные|понечётным|понечетным|н|нч)$/.test(s)) return 'odd'
  return s
}

export function onWeek(spec: string, week: number): boolean {
  const s = spec.trim()
  if (!s) return true
  if (s === 'even') return isEvenWeek(week)
  if (s === 'odd') return !isEvenWeek(week)
  return s.split(',').some((part) => {
    const m = part.match(RANGE)
    if (!m) return false
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    return week >= a && week <= b
  })
}

// Сколько занятий за семестр (для списка секций)
export function sessionsInSemester(sessions: SportSession[], maxWeek: number): number {
  let n = 0
  for (const s of sessions) for (let w = 1; w <= maxWeek; w++) if (onWeek(s.weeks, w)) n++
  return n
}

// Эмодзи секции по названию (владелец может задать своё)
const EMOJI: [RegExp, string][] = [
  [/баскет/i, '🏀'],
  [/волейб/i, '🏐'],
  [/мини-?футбол|футбол/i, '⚽'],
  [/хокке/i, '🏒'],
  [/настольн/i, '🏓'],
  [/теннис/i, '🎾'],
  [/бадминт/i, '🏸'],
  [/плаван|бассейн|аква/i, '🏊'],
  [/бокс|кикбокс/i, '🥊'],
  [/самооборон|борьб|дзюдо|самбо|карате|тхэквондо|единоборств/i, '🥋'],
  [/аэроб|фитнес|гимнаст|степ/i, '🤸'],
  [/йог|пилатес|стретч/i, '🧘'],
  [/атлетизм|тренаж|пауэр|тяжёл|тяжел|гиревой/i, '🏋️'],
  [/лёгк|легк|бег/i, '🏃'],
  [/шахмат|шашк/i, '♟️'],
  [/кибер/i, '🎮'],
  [/танц|хореогр|чирлид/i, '💃'],
  [/лыж/i, '⛷️'],
  [/стрельб|дартс/i, '🎯'],
  [/смг|медицинск|лфк|оздоров/i, '❤️'],
  [/офп|общая физ/i, '💪'],
]

export const sectionEmoji = (s: Pick<SportSection, 'name' | 'emoji'>) =>
  s.emoji || EMOJI.find(([re]) => re.test(s.name))?.[1] || '🏅'
