// Расписание в боте: те же файлы групп data/schedule/<id>.json, overrides.json и overrides/*.json,
// что у мини-приложения (берём с сайта), и та же логика недель — shared/schedule-core.ts.
// Плюс ручные правки из админ-панели (edits.ts).
import { WEEKDAYS_FULL, formatDate, weekTitle } from '../../shared/format-core'
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import {
  isoFromDay,
  makeTimetable,
  moscowNow,
  scheduleFromGroups,
  type DayReplacement,
  type GroupFile,
  type Lesson,
  type Overrides,
  type Timetable,
} from '../../shared/schedule-core'
import { loadEdits, type ScheduleEdit } from './edits'
import { escapeHtml } from './util'

// replacements — замены дней целиком из файлов репозитория (их показывает админ-панель)
export type BotTimetable = Timetable & { edits: ScheduleEdit[]; replacements: FileReplacement[] }
export type FileReplacement = DayReplacement & { file: string }

// Замены дней целиком: файлы лежат на сайте рядом с данными (см. vite.config.ts)
const REPLACEMENT_FILES = ['overrides/thursday.json', 'overrides/thursday-1-2.json']

// Сайт отдаёт файлы с кэшем CDN; храним разобранное и в памяти воркера на минуту
const MEMORY_TTL_MS = 60_000
const groupCache = new Map<string, { at: number; file: GroupFile | null }>()
let extras: { at: number; overrides: Overrides; replacements: FileReplacement[] } | null = null

class NotFound extends Error {}

async function fetchJson<T>(env: Env, name: string): Promise<T> {
  const url = new URL(name, env.WEBAPP_URL)
  const res = await fetch(url.toString(), { cf: { cacheTtl: 120, cacheEverything: true } })
  // 404 — нет файла; HTML вместо JSON — тоже (так отвечают сервера, которые на любой путь отдают сайт)
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) throw new NotFound(`${name}: нет на сайте`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()) as T
}

// Файл группы; такой группы нет — null
export async function loadGroupFile(env: Env, id: string): Promise<GroupFile | null> {
  const hit = groupCache.get(id)
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.file
  let file: GroupFile | null = null
  try {
    file = await fetchJson<GroupFile>(env, `data/schedule/${id}.json`)
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
  }
  groupCache.set(id, { at: Date.now(), file })
  return file
}

async function loadExtras(env: Env): Promise<NonNullable<typeof extras>> {
  if (extras && Date.now() - extras.at < MEMORY_TTL_MS) return extras
  const [overrides, ...files] = await Promise.all([
    fetchJson<Overrides>(env, 'overrides.json').catch(() => ({}) as Overrides),
    ...REPLACEMENT_FILES.map((file) =>
      fetchJson<DayReplacement>(env, file).then(
        (r) => ({ ...r, file }),
        (err) => (console.error(`Замена дня ${file}:`, err), null),
      ),
    ),
  ])
  extras = { at: Date.now(), overrides, replacements: files.filter((r): r is FileReplacement => r !== null) }
  return extras
}

// Группы, которые понадобятся: своя группа, а если её нет — МБ(МП) 1-1 и 1-2 (как раньше)
export const groupsFor = (group: string | null | undefined): string[] => {
  const id = normalizeGroup(group)
  return id ? [id] : MB_IDS
}

// Расписание этих групп вместе с ручными правками; правки недоступны — показываем без них.
// Группы, которой нет на сайте, в расписании просто не будет.
export async function loadTimetable(env: Env, groups: string[]): Promise<BotTimetable> {
  const ids = [...new Set(groups.map((g) => normalizeGroup(g)).filter((g): g is string => Boolean(g)))]
  const [files, extra, edits] = await Promise.all([
    Promise.all(ids.map((id) => loadGroupFile(env, id))),
    loadExtras(env),
    loadEdits(env).catch((err) => (console.error('Правки расписания:', err), [] as ScheduleEdit[])),
  ])
  const found = files.filter((f): f is GroupFile => f !== null)
  const timetable = makeTimetable(scheduleFromGroups(found), extra.overrides, extra.replacements)
  return { ...timetable, edits, replacements: extra.replacements }
}

// Пары дня с правками: отменённая — зачёркнута, пометки — 📌. Пометки ко всему дню — сверху.
function dayLines(tt: BotTimetable, group: string, day: number, lessons: Lesson[]): string[] {
  const iso = isoFromDay(day)
  const edits = tt.edits.filter((e) => e.group === group && e.date === iso)
  const lines = edits.filter((e) => e.start === null).map((e) => `📌 ${escapeHtml(e.text)}`)
  for (const lesson of lessons) {
    const own = edits.filter((e) => e.start === lesson.start)
    const cancel = own.find((e) => e.kind === 'cancel')
    const line = `${tt.pairNumber(lesson)}. ${formatLesson(lesson)}`
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
  const teacher = lesson.teachers?.join(', ') ?? lesson.teacher
  const extra = [lesson.room, teacher].filter(Boolean).map((s) => escapeHtml(s!))
  return [`${lesson.start}–${lesson.end}`, title, ...extra].join(' · ')
}

// Пары на день для одной группы или для всех загруженных (если группа не выбрана) — HTML
export function formatDay(tt: BotTimetable, day: number, group: string | null): string {
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const header = `📅 <b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b>`
  if (group && !tt.schedule.groups.includes(group)) {
    return `${header}\nНе нашёл расписание вашей группы — откройте приложение и выберите группу заново.`
  }
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`]
  for (const g of group ? [group] : tt.schedule.groups) {
    const lessons = tt.lessonsOn(g, week, weekday)
    if (!group) lines.push('', `<b>${escapeHtml(tt.nameOf(g))}</b>`)
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
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`, `<b>${escapeHtml(tt.nameOf(group))}</b>`]
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
