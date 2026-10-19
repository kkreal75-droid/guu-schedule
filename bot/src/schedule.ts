// Расписание в боте: те же schedule.json и overrides.json, что у мини-приложения (берём с сайта),
// и та же логика недель — shared/schedule-core.ts. Плюс ручные правки из админ-панели (edits.ts).
import { WEEKDAYS_FULL, formatDate, weekTitle } from '../../shared/format-core'
import { isoFromDay, makeTimetable, moscowNow, type Lesson, type Overrides, type Schedule, type Timetable } from '../../shared/schedule-core'
import { loadEdits, type ScheduleEdit } from './edits'
import { escapeHtml } from './util'

export type BotTimetable = Timetable & { edits: ScheduleEdit[] }

// Сайт отдаёт файлы с кэшем CDN; храним разобранное и в памяти воркера на минуту
const MEMORY_TTL_MS = 60_000
let cached: { at: number; timetable: Timetable } | null = null

async function fetchJson<T>(env: Env, name: string): Promise<T> {
  const url = new URL(name, env.WEBAPP_URL)
  const res = await fetch(url.toString(), { cf: { cacheTtl: 120, cacheEverything: true } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()) as T
}

async function loadBase(env: Env): Promise<Timetable> {
  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.timetable
  const [schedule, overrides] = await Promise.all([
    fetchJson<Schedule>(env, 'schedule.json'),
    fetchJson<Overrides>(env, 'overrides.json').catch(() => ({}) as Overrides),
  ])
  cached = { at: Date.now(), timetable: makeTimetable(schedule, overrides) }
  return cached.timetable
}

// Расписание вместе с ручными правками; правки недоступны — показываем без них
export async function loadTimetable(env: Env): Promise<BotTimetable> {
  const [timetable, edits] = await Promise.all([
    loadBase(env),
    loadEdits(env).catch((err) => (console.error('Правки расписания:', err), [] as ScheduleEdit[])),
  ])
  return { ...timetable, edits }
}

// Пары дня с правками: отменённая — зачёркнута, пометки — 📌. Пометки ко всему дню — сверху.
function dayLines(tt: BotTimetable, group: string, day: number, lessons: Lesson[]): string[] {
  const iso = isoFromDay(day)
  const edits = tt.edits.filter((e) => e.group === group && e.date === iso)
  const lines = edits.filter((e) => e.start === null).map((e) => `📌 ${escapeHtml(e.text)}`)
  for (const lesson of lessons) {
    const own = edits.filter((e) => e.start === lesson.start)
    const cancel = own.find((e) => e.kind === 'cancel')
    const line = `${tt.pairNumber(lesson.start)}. ${formatLesson(lesson)}`
    lines.push(cancel ? `<s>${line}</s>\n   ❌ Отменена${cancel.text ? `: ${escapeHtml(cancel.text)}` : ''}` : line)
    for (const note of own.filter((e) => e.kind === 'note')) lines.push(`   📌 ${escapeHtml(note.text)}`)
  }
  // пометка ко времени, где пары уже нет (расписание поменялось), — не теряем
  const starts = new Set(lessons.map((l) => l.start))
  for (const e of edits) if (e.kind === 'note' && e.start && !starts.has(e.start)) lines.push(`📌 ${e.start} — ${escapeHtml(e.text)}`)
  return lines
}

// «09:00–10:30 · Математика (Лекция) · У-349 · Дадашов Ч.М.»
export function formatLesson(lesson: Lesson): string {
  const title = `<b>${escapeHtml(lesson.subject)}</b>${lesson.kind ? ` (${escapeHtml(lesson.kind)})` : ''}`
  const extra = [lesson.room, lesson.teacher].filter(Boolean).map((s) => escapeHtml(s!))
  return [`${lesson.start}–${lesson.end}`, title, ...extra].join(' · ')
}

// Пары на день для одной или обеих групп (если группа не выбрана) — HTML
export function formatDay(tt: BotTimetable, day: number, group: string | null): string {
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const header = `📅 <b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b>`
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`]
  for (const g of group ? [group] : tt.schedule.groups) {
    const lessons = tt.lessonsOn(g, week, weekday)
    if (!group) lines.push('', `<b>${escapeHtml(g)}</b>`)
    const withEdits = dayLines(tt, g, day, lessons)
    if (!lessons.length) lines.push(weekday === 6 ? 'Воскресенье — выходной 🌿' : 'Пар нет 🎉')
    lines.push(...withEdits)
  }
  return lines.join('\n')
}

// Неделя одной группы: Пн–Сб по дням — HTML
export function formatWeek(tt: BotTimetable, monday: number, group: string): string {
  const week = tt.weekOf(monday)
  const range = `${formatDate(monday)} – ${formatDate(monday + 5)}`
  const header = `🗓 <b>Неделя ${range}</b>`
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`, `<b>${escapeHtml(group)}</b>`]
  for (let weekday = 0; weekday < 6; weekday++) {
    const lessons = tt.lessonsOn(group, week, weekday)
    lines.push('', `<b>${WEEKDAYS_FULL[weekday]}, ${formatDate(monday + weekday)}</b>`)
    if (!lessons.length) lines.push('Пар нет 🎉')
    lines.push(...dayLines(tt, group, monday + weekday, lessons))
  }
  const text = lines.join('\n')
  // Telegram не примет больше 4096 символов — режем по строке
  return text.length <= 4096 ? text : `${text.slice(0, text.lastIndexOf('\n', 4080))}\n…`
}

export const todayMsk = () => moscowNow().day
