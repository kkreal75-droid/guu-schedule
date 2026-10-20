// Расписание в боте: те же файлы групп data/schedule/<id>.json, overrides.json и overrides/*.json,
// что у мини-приложения (берём с сайта), и та же логика недель — shared/schedule-core.ts.
// Плюс ручные правки из админ-панели (edits.ts).
import { WEEKDAYS_FULL, formatDate, weekTitle } from '../../shared/format-core'
import { MB_IDS, normalizeGroup, type GroupsIndex } from '../../shared/groups'
import {
  makeTimetable,
  moscowNow,
  scheduleFromGroups,
  teacherAsGroup,
  teacherKey,
  type DayReplacement,
  type TeacherFile,
  type GroupFile,
  type Lesson,
  type Overrides,
  type Timetable,
} from '../../shared/schedule-core'
import { NO_EXTRAS, dayLessons, shortWhen, type DayLesson, type Extras } from '../../shared/edits-core'
import { loadExtras } from './edits'
import { escapeHtml } from './util'

// extras — ручные правки, подгруппы, метки пар (edits.ts); replacements — замены дней целиком из файлов
// репозитория (их показывает админ-панель)
export type BotTimetable = Timetable & { extras: Extras; replacements: FileReplacement[] }
export type FileReplacement = DayReplacement & { file: string }

// Замены дней целиком: файлы лежат на сайте рядом с данными (см. vite.config.ts)
const REPLACEMENT_FILES = ['overrides/thursday.json', 'overrides/thursday-1-2.json']

// Сайт отдаёт файлы с кэшем CDN; храним разобранное и в памяти воркера на минуту
const MEMORY_TTL_MS = 60_000
const groupCache = new Map<string, { at: number; file: GroupFile | null }>()
const teacherCache = new Map<string, { at: number; file: TeacherFile | null }>()
let indexCache: { at: number; index: GroupsIndex } | null = null
const INDEX_TTL_MS = 10 * 60_000
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

// Файл преподавателя; такого нет — null
export async function loadTeacherFile(env: Env, id: string): Promise<TeacherFile | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return null
  const hit = teacherCache.get(id)
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.file
  let file: TeacherFile | null = null
  try {
    file = await fetchJson<TeacherFile>(env, `data/teachers/${id}.json`)
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
  }
  teacherCache.set(id, { at: Date.now(), file })
  return file
}

// Все группы (data/groups.json, ~170 КБ) — для поиска в /setup и рассылки по фильтрам; кэш 10 минут
export async function loadGroupsIndex(env: Env): Promise<GroupsIndex> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.index
  const index = await fetchJson<GroupsIndex>(env, 'data/groups.json')
  indexCache = { at: Date.now(), index }
  return index
}

// Чьё расписание показывать человеку: преподавателю — его, студенту — его группы
export const personalKey = (user: { role?: string | null; teacher_id?: string | null; grp?: string | null } | null) =>
  user?.role === 'teacher' && user.teacher_id ? teacherKey(user.teacher_id) : normalizeGroup(user?.grp)

async function loadFileExtras(env: Env): Promise<NonNullable<typeof extras>> {
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

// Группы, которые понадобятся: своя группа (или «t-<id>» преподавателя), а если её нет —
// МБ(МП) 1-1 и 1-2 (как раньше)
export const groupsFor = (group: string | null | undefined): string[] => {
  if (group?.startsWith('t-')) return [group]
  const id = normalizeGroup(group)
  return id ? [id] : MB_IDS
}

// Расписание этих групп вместе с ручными правками; правки недоступны — показываем без них.
// Группы, которой нет на сайте, в расписании просто не будет.
export async function loadTimetable(env: Env, groups: string[]): Promise<BotTimetable> {
  const ids = [...new Set(groups.map((g) => (g.startsWith('t-') ? g : normalizeGroup(g))).filter((g): g is string => Boolean(g)))]
  const load = async (id: string) => {
    if (!id.startsWith('t-')) return loadGroupFile(env, id)
    const teacher = await loadTeacherFile(env, id.slice(2))
    return teacher ? teacherAsGroup(teacher) : null
  }
  const [files, extra, extras] = await Promise.all([
    Promise.all(ids.map(load)),
    loadFileExtras(env),
    loadExtras(env).catch((err) => (console.error('Правки расписания:', err), NO_EXTRAS)),
  ])
  const found = files.filter((f): f is GroupFile => f !== null)
  const timetable = makeTimetable(scheduleFromGroups(found), extra.overrides, extra.replacements)
  return { ...timetable, extras, replacements: extra.replacements }
}

// Пары дня с правками: отменённая — зачёркнута, перенесённая — «перенесена на …», добавленная — ➕,
// пометки — 📌, подгруппа — в скобках. Пометки ко всему дню — сверху. mine — выбранные подгруппы.
function dayLines(tt: BotTimetable, group: string, day: number, mine: number[] | null): { lines: string[]; count: number } {
  const view = dayLessons(tt, group, day, tt.extras, mine)
  const lines = view.notes.map((n) => `📌 ${escapeHtml(n)}`)
  for (const lesson of view.lessons) {
    const pair = lesson.pair ?? (lesson.added || lesson.movedFrom ? null : tt.pairNumber(lesson))
    const line = `${pair ? `${pair}. ` : '• '}${formatLesson(lesson)}`
    if (lesson.cancel) lines.push(`<s>${line}</s>\n   ❌ Отменена${lesson.cancel.text ? `: ${escapeHtml(lesson.cancel.text)}` : ''}`)
    else if (lesson.movedTo) lines.push(`<s>${line}</s>\n   ↪️ Перенесена на ${shortWhen(lesson.movedTo.date, lesson.movedTo.start)}`)
    else lines.push(line)
    if (lesson.added) lines.push('   ➕ Добавлена')
    if (lesson.movedFrom) lines.push(`   ↩️ Перенос с ${shortWhen(lesson.movedFrom.date, lesson.movedFrom.start)}`)
    for (const note of lesson.notes) lines.push(`   📌 ${escapeHtml(note)}`)
  }
  return { lines, count: view.lessons.length }
}

// «09:00–10:30 · Математика (Лекция) · У-349 · Дадашов Ч.М.»
export function formatLesson(lesson: Lesson | DayLesson): string {
  const sub = 'subgroup' in lesson && lesson.subgroup ? ` [${escapeHtml(lesson.subgroup.name)}]` : ''
  const title = `<b>${escapeHtml(lesson.subject)}</b>${lesson.kind ? ` (${escapeHtml(lesson.kind)})` : ''}${sub}`
  const teacher = lesson.teachers?.join(', ') ?? lesson.teacher
  const extra = [lesson.room, teacher].filter(Boolean).map((s) => escapeHtml(s!))
  return [`${lesson.start}–${lesson.end}`, title, ...extra].join(' · ')
}

// Пары на день для одной группы или для всех загруженных (если группа не выбрана) — HTML.
// mine — подгруппы человека (личные /today, inline): чужие пары подгрупп не показываем.
export function formatDay(tt: BotTimetable, day: number, group: string | null, mine: number[] | null = null): string {
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const header = `📅 <b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b>`
  if (group && !tt.schedule.groups.includes(group)) {
    return `${header}\nНе нашёл расписание вашей группы — откройте приложение и выберите группу заново.`
  }
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`]
  for (const g of group ? [group] : tt.schedule.groups) {
    if (!group) lines.push('', `<b>${escapeHtml(tt.nameOf(g))}</b>`)
    const day_ = dayLines(tt, g, day, mine)
    if (!day_.count) lines.push(weekday === 6 ? 'Воскресенье — выходной 🌿' : 'Пар нет 🎉')
    lines.push(...day_.lines)
  }
  return lines.join('\n')
}

// Неделя одной группы: Пн–Сб по дням — HTML
export function formatWeek(tt: BotTimetable, monday: number, group: string, mine: number[] | null = null): string {
  const week = tt.weekOf(monday)
  const range = `${formatDate(monday)} – ${formatDate(monday + 5)}`
  const header = `🗓 <b>Неделя ${range}</b>`
  if (!tt.inSemester(week)) return `${header}\nВне учебного семестра.`
  const lines = [`${header} · ${weekTitle(week).toLowerCase()}`, `<b>${escapeHtml(tt.nameOf(group))}</b>`]
  for (let weekday = 0; weekday < 6; weekday++) {
    const day_ = dayLines(tt, group, monday + weekday, mine)
    lines.push('', `<b>${WEEKDAYS_FULL[weekday]}, ${formatDate(monday + weekday)}</b>`)
    if (!day_.count) lines.push('Пар нет 🎉')
    lines.push(...day_.lines)
  }
  const text = lines.join('\n')
  // Telegram не примет больше 4096 символов — режем по строке
  return text.length <= 4096 ? text : `${text.slice(0, text.lastIndexOf('\n', 4080))}\n…`
}

export const todayMsk = () => moscowNow().day
