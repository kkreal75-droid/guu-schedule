// Расписание в боте: те же schedule.json и overrides.json, что у мини-приложения (берём с сайта),
// и та же логика недель — shared/schedule-core.ts.
import { WEEKDAYS_FULL, formatDate, weekTitle } from '../../shared/format-core'
import { makeTimetable, moscowNow, type Lesson, type Overrides, type Schedule, type Timetable } from '../../shared/schedule-core'
import { escapeHtml } from './util'

// Сайт отдаёт файлы с кэшем CDN; храним разобранное и в памяти воркера на минуту
const MEMORY_TTL_MS = 60_000
let cached: { at: number; timetable: Timetable } | null = null

async function fetchJson<T>(env: Env, name: string): Promise<T> {
  const url = new URL(name, env.WEBAPP_URL)
  const res = await fetch(url.toString(), { cf: { cacheTtl: 120, cacheEverything: true } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function loadTimetable(env: Env): Promise<Timetable> {
  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.timetable
  const [schedule, overrides] = await Promise.all([
    fetchJson<Schedule>(env, 'schedule.json'),
    fetchJson<Overrides>(env, 'overrides.json').catch(() => ({}) as Overrides),
  ])
  cached = { at: Date.now(), timetable: makeTimetable(schedule, overrides) }
  return cached.timetable
}

// «09:00–10:30 · Математика (Лекция) · У-349 · Дадашов Ч.М.»
export function formatLesson(lesson: Lesson): string {
  const title = `<b>${escapeHtml(lesson.subject)}</b>${lesson.kind ? ` (${escapeHtml(lesson.kind)})` : ''}`
  const extra = [lesson.room, lesson.teacher].filter(Boolean).map((s) => escapeHtml(s!))
  return [`${lesson.start}–${lesson.end}`, title, ...extra].join(' · ')
}

// Пары на день для одной или обеих групп (если группа не выбрана) — HTML
export function formatDay(tt: Timetable, day: number, group: string | null): string {
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const header = `📅 <b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b>`
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`]
  for (const g of group ? [group] : tt.schedule.groups) {
    const lessons = tt.lessonsOn(g, week, weekday)
    if (!group) lines.push('', `<b>${escapeHtml(g)}</b>`)
    if (!lessons.length) lines.push(weekday === 6 ? 'Воскресенье — выходной 🌿' : 'Пар нет 🎉')
    else lines.push(...lessons.map((l) => `${tt.pairNumber(l.start)}. ${formatLesson(l)}`))
  }
  return lines.join('\n')
}

// Неделя одной группы: Пн–Сб по дням — HTML
export function formatWeek(tt: Timetable, monday: number, group: string): string {
  const week = tt.weekOf(monday)
  const range = `${formatDate(monday)} – ${formatDate(monday + 5)}`
  const header = `🗓 <b>Неделя ${range}</b>`
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`, `<b>${escapeHtml(group)}</b>`]
  for (let weekday = 0; weekday < 6; weekday++) {
    const lessons = tt.lessonsOn(group, week, weekday)
    lines.push('', `<b>${WEEKDAYS_FULL[weekday]}, ${formatDate(monday + weekday)}</b>`)
    if (!lessons.length) lines.push('Пар нет 🎉')
    else lines.push(...lessons.map((l) => `${tt.pairNumber(l.start)}. ${formatLesson(l)}`))
  }
  const text = lines.join('\n')
  // Telegram не примет больше 4096 символов — режем по строке
  return text.length <= 4096 ? text : `${text.slice(0, text.lastIndexOf('\n', 4080))}\n…`
}

export const todayMsk = () => moscowNow().day
