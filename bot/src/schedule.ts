// Расписание в боте: те же файлы групп data/schedule/<id>.json, overrides.json и overrides/*.json,
// что у мини-приложения (берём с сайта), и та же логика недель — shared/schedule-core.ts.
// Плюс ручные правки из админ-панели (edits.ts).
import type { ComputedCalendar } from '../../shared/calendar-core'
import { WEEKDAYS_FULL, formatDate, weekTitle } from '../../shared/format-core'
import { weekdayName } from '../../shared/i18n-core'
import { MB_IDS, normalizeGroup, type GroupsIndex } from '../../shared/groups'
import {
  dayOffTitle,
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
import { NO_EXTRAS, dayLessons, shortWhen, type DayLesson, type Extras, type HiddenLesson } from '../../shared/edits-core'
import repoOverrides from '../../overrides.json'
import { loadExtras } from './edits'
import { RU, kindIn, looksLikeNames, peopleIn, roomIn, subjectIn, tr, type Locale } from './i18n'
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

// Первая и последняя пара курса (data/calendar.json, update.py) — учебный график; кэш 10 минут, нет файла — null
let calendarCache: { at: number; data: ComputedCalendar | null } | null = null
export async function loadComputedCalendar(env: Env): Promise<ComputedCalendar | null> {
  if (calendarCache && Date.now() - calendarCache.at < INDEX_TTL_MS) return calendarCache.data
  let data: ComputedCalendar | null = null
  try {
    data = await fetchJson<ComputedCalendar>(env, 'data/calendar.json')
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
  }
  calendarCache = { at: Date.now(), data }
  return data
}

// Все преподаватели (data/teachers.json) — имена для админки «Отзывы»; кэш 10 минут
let teachersCache: { at: number; index: { teachers: { id: string; name: string }[] } } | null = null
export async function loadTeachersIndex(env: Env): Promise<{ teachers: { id: string; name: string }[] }> {
  if (teachersCache && Date.now() - teachersCache.at < INDEX_TTL_MS) return teachersCache.index
  const index = await fetchJson<{ teachers: { id: string; name: string }[] }>(env, 'data/teachers.json')
  teachersCache = { at: Date.now(), index }
  return index
}

// Чьё расписание показывать человеку: преподавателю — его, студенту — его группы
export const personalKey = (user: { role?: string | null; teacher_id?: string | null; grp?: string | null } | null) =>
  user?.role === 'teacher' && user.teacher_id ? teacherKey(user.teacher_id) : normalizeGroup(user?.grp)

async function loadFileExtras(env: Env): Promise<NonNullable<typeof extras>> {
  if (extras && Date.now() - extras.at < MEMORY_TTL_MS) return extras
  const [overrides, ...files] = await Promise.all([
    // сайт не ответил — прошлые правки, а до первой загрузки — overrides.json на момент деплоя (выходные не пропадут)
    fetchJson<Overrides>(env, 'overrides.json').catch(() => extras?.overrides ?? (repoOverrides as Overrides)),
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

// Расписание человека: его скрытые пары («Это не моя пара») поверх общих правок — календарь, inline, /today в личке
export const personalize = (tt: BotTimetable, hidden: HiddenLesson[]): BotTimetable =>
  hidden.length ? { ...tt, extras: { ...tt.extras, hidden: [...(tt.extras.hidden ?? []), ...hidden] } } : tt

// Пары дня с правками: отменённая — зачёркнута, перенесённая — «перенесена на …», добавленная — ➕,
// пометки — 📌, подгруппа — в скобках. Пометки ко всему дню — сверху. mine — выбранные подгруппы.
function dayLines(tt: BotTimetable, group: string, day: number, mine: number[] | null, loc: Locale): { lines: string[]; count: number } {
  const view = dayLessons(tt, group, day, tt.extras, mine)
  const lines = view.notes.map((n) => `📌 ${escapeHtml(n)}`)
  for (const lesson of view.lessons) {
    const pair = lesson.pair ?? (lesson.added || lesson.movedFrom ? null : tt.pairNumber(lesson))
    const line = `${pair ? `${pair}. ` : '• '}${formatLesson(lesson, loc)}`
    if (lesson.cancel) lines.push(`<s>${line}</s>\n   ❌ ${tr(loc.lang, 'Отменена')}${lesson.cancel.text ? `: ${escapeHtml(lesson.cancel.text)}` : ''}`)
    else if (lesson.movedTo) lines.push(`<s>${line}</s>\n   ↪️ ${tr(loc.lang, 'Перенесена на {when}', { when: shortWhen(lesson.movedTo.date, lesson.movedTo.start) })}`)
    else lines.push(line)
    if (lesson.added) lines.push(`   ➕ ${tr(loc.lang, 'Добавлена')}`)
    if (lesson.movedFrom) lines.push(`   ↩️ ${tr(loc.lang, 'Перенос с {when}', { when: shortWhen(lesson.movedFrom.date, lesson.movedFrom.start) })}`)
    for (const note of lesson.notes) lines.push(`   📌 ${escapeHtml(note)}`)
  }
  return { lines, count: view.lessons.length }
}

// «09:00–10:30 · Математика (Лекция) · У-349 · Дадашов Ч.М.»; по-английски — «… · History of Russia (Lecture) · ЛК-405 · Kriukova E.V.»
export function formatLesson(lesson: Lesson | DayLesson, loc: Locale = RU): string {
  const sub = 'subgroup' in lesson && lesson.subgroup ? ` [${escapeHtml(lesson.subgroup.name)}]` : ''
  const title = `<b>${escapeHtml(subjectIn(loc, lesson.subject))}</b>${lesson.kind ? ` (${escapeHtml(kindIn(loc, lesson.kind))})` : ''}${sub}`
  const teacher = lesson.teachers?.join(', ') ?? lesson.teacher
  const extra = [lesson.room && roomIn(loc, lesson.room), teacher && peopleIn(loc, teacher)].filter(Boolean).map((s) => escapeHtml(s!))
  return [`${lesson.start}–${lesson.end}`, title, ...extra].join(' · ')
}

// Строка formatLesson по-русски (так хранятся снимки «пары на 7 дней», digest.ts) → на языке беседы
const unescapeHtml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
export function localizeLessonLine(line: string, loc: Locale): string {
  if (loc.lang === 'ru') return line
  const m = line.match(/^(\S+) · <b>(.*?)<\/b>(?: \(([^)]*)\))?((?: \[[^\]]*\])?)(.*)$/)
  if (!m) return line
  const [, time, subject, kind, sub, rest] = m
  const title = `<b>${escapeHtml(subjectIn(loc, unescapeHtml(subject)))}</b>${kind ? ` (${escapeHtml(kindIn(loc, unescapeHtml(kind)))})` : ''}${sub}`
  // аудитория и преподаватель (formatLesson пишет их по порядку); одно из двух — по виду: ФИО или аудитория
  const parts = rest.split(' · ').slice(1).map(unescapeHtml)
  const extra = parts.map((part, i) =>
    escapeHtml((parts.length > 1 ? i === 1 : looksLikeNames(part)) ? peopleIn(loc, part) : roomIn(loc, part)),
  )
  return [time, title, ...extra].join(' · ')
}

// день недели: по-русски — как раньше, по-английски — Intl
const weekdayIn = (loc: Locale, weekday: number) => (loc.lang === 'en' ? weekdayName(weekday, 'en') : WEEKDAYS_FULL[weekday])
// «Среда, 21 октября» / «Wednesday, 21 October»
export const dayTitle = (loc: Locale, weekday: number, day: number) => `${weekdayIn(loc, weekday)}, ${formatDate(day, loc.lang)}`

// Выходной для всех (overrides.json → days_off): «Выходной — День народного единства 🎉»; не выходной — null
export function dayOffLine(tt: Timetable, day: number, lang: Locale['lang']): string | null {
  const off = tt.dayOff(day)
  return off ? tr(lang, 'Выходной — {title} 🎉', { title: escapeHtml(dayOffTitle(off, lang)) }) : null
}

// Пары на день для одной группы или для всех загруженных (если группа не выбрана) — HTML.
// mine — подгруппы человека (личные /today, inline): чужие пары подгрупп не показываем. loc — язык сообщения.
export function formatDay(tt: BotTimetable, day: number, group: string | null, mine: number[] | null = null, loc: Locale = RU): string {
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const header = `📅 <b>${dayTitle(loc, weekday, day)}</b>`
  if (group && !tt.schedule.groups.includes(group)) {
    return `${header}\n${tr(loc.lang, 'Не нашёл расписание вашей группы — откройте приложение и выберите группу заново.')}`
  }
  if (!tt.inSemester(week)) return `${header}\n${tr(loc.lang, 'Вне учебного семестра.')}`
  const lines = [`${header} · ${weekTitle(week, loc.lang).toLowerCase()}`]
  for (const g of group ? [group] : tt.schedule.groups) {
    if (!group) lines.push('', `<b>${escapeHtml(tt.nameOf(g))}</b>`)
    const day_ = dayLines(tt, g, day, mine, loc)
    if (!day_.count) lines.push(dayOffLine(tt, day, loc.lang) ?? tr(loc.lang, weekday === 6 ? 'Воскресенье — выходной 🌿' : 'Пар нет 🎉'))
    lines.push(...day_.lines)
  }
  return lines.join('\n')
}

// Неделя одной группы: Пн–Сб по дням — HTML
export function formatWeek(tt: BotTimetable, monday: number, group: string, mine: number[] | null = null, loc: Locale = RU): string {
  const week = tt.weekOf(monday)
  const range = `${formatDate(monday, loc.lang)} – ${formatDate(monday + 5, loc.lang)}`
  const header = `🗓 <b>${tr(loc.lang, 'Неделя {range}', { range })}</b>`
  if (!tt.inSemester(week)) return `${header}\n${tr(loc.lang, 'Вне учебного семестра.')}`
  const lines = [`${header} · ${weekTitle(week, loc.lang).toLowerCase()}`, `<b>${escapeHtml(tt.nameOf(group))}</b>`]
  for (let weekday = 0; weekday < 6; weekday++) {
    const day_ = dayLines(tt, group, monday + weekday, mine, loc)
    lines.push('', `<b>${dayTitle(loc, weekday, monday + weekday)}</b>`)
    if (!day_.count) lines.push(dayOffLine(tt, monday + weekday, loc.lang) ?? tr(loc.lang, 'Пар нет 🎉'))
    lines.push(...day_.lines)
  }
  const text = lines.join('\n')
  // Telegram не примет больше 4096 символов — режем по строке
  return text.length <= 4096 ? text : `${text.slice(0, text.lastIndexOf('\n', 4080))}\n…`
}

export const todayMsk = () => moscowNow().day
