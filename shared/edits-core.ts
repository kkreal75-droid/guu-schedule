// Ручные правки расписания поверх файлов ГУУ — общее для приложения, бота и календаря.
//   cancel — пара отменена; note — пометка к паре (start) или ко всему дню (start = null);
//   add — пара добавлена (data: время, предмет, …); move — пара перенесена (data: куда).
// Правки делают владелец (админ-панель) и старосты (только своей группы). Хранятся в D1
// schedule_edits — автообновление их не трогает. Подгруппы (языки и т. п.) — пары, помеченные
// подгруппой, студент видит, только если выбрал её (или не выбрал ни одной).
import { dayFromIso, isoFromDay, type Lesson, type Timetable } from './schedule-core'

export type EditKind = 'cancel' | 'note' | 'add' | 'move'

export type AddData = {
  start: string
  end: string
  subject: string
  kind?: string | null
  teacher?: string | null
  room?: string | null
  subgroup?: number | null
}
export type MoveData = { to_date: string; to_start: string; to_end: string; room?: string | null }

export type ScheduleEdit = {
  id: number
  group: string
  date: string // ГГГГ-ММ-ДД
  start: string | null
  kind: EditKind
  text: string
  data?: AddData | MoveData | null
  author?: string | null // кто сделал (видит владелец): null — владелец
}

export type Subgroup = { id: number; group: string; name: string }
// пара из файла ГУУ, которая относится к подгруппе: день недели, время, предмет (и преподаватель)
export type LessonTag = { id: number; group: string; weekday: number; start: string; subject: string; teacher: string | null; subgroup: number }

export type Extras = { edits: ScheduleEdit[]; subgroups: Subgroup[]; tags: LessonTag[] }
export const NO_EXTRAS: Extras = { edits: [], subgroups: [], tags: [] }

export type DayLesson = Lesson & {
  cancel: { text: string } | null // отменена
  movedTo: { date: string; start: string } | null // перенесена отсюда
  movedFrom: { date: string; start: string } | null // перенесена сюда
  added: boolean // добавлена правкой
  notes: string[]
  subgroup: Subgroup | null
}

export type DayView = { lessons: DayLesson[]; notes: string[] /* ко всему дню */ }

const isMove = (e: ScheduleEdit): e is ScheduleEdit & { data: MoveData } => e.kind === 'move' && Boolean(e.data && 'to_date' in e.data)
const isAdd = (e: ScheduleEdit): e is ScheduleEdit & { data: AddData } => e.kind === 'add' && Boolean(e.data && 'subject' in e.data)

// Подгруппа пары из файла — по меткам старосты
export function subgroupOf(lesson: Lesson, extras: Extras): Subgroup | null {
  const tag = extras.tags.find(
    (t) =>
      t.group === lesson.group &&
      t.weekday === lesson.weekday &&
      t.start === lesson.start &&
      t.subject === lesson.subject &&
      (!t.teacher || t.teacher === lesson.teacher),
  )
  return tag ? (extras.subgroups.find((s) => s.id === tag.subgroup) ?? null) : null
}

// Пары группы на день со всеми правками. mine — выбранные подгруппы: пары чужих подгрупп скрываем
// (пусто или null — показываем все).
export function dayLessons(tt: Timetable, group: string, day: number, extras: Extras, mine: number[] | null = null): DayView {
  const iso = isoFromDay(day)
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const edits = extras.edits.filter((e) => e.group === group)
  const today = edits.filter((e) => e.date === iso)
  const base: DayLesson[] = (tt.inSemester(week) ? tt.lessonsOn(group, week, weekday) : []).map((l) => ({
    ...l,
    cancel: null,
    movedTo: null,
    movedFrom: null,
    added: false,
    notes: [],
    subgroup: subgroupOf(l, extras),
  }))

  for (const e of today) {
    const own = e.start ? base.filter((l) => l.start === e.start) : []
    if (e.kind === 'cancel') own.forEach((l) => (l.cancel = { text: e.text }))
    if (e.kind === 'note') own.forEach((l) => l.notes.push(e.text))
    if (isMove(e)) own.forEach((l) => (l.movedTo = { date: e.data.to_date, start: e.data.to_start }))
  }
  // перенесённые сюда: копия исходной пары в новое время
  for (const e of edits.filter((x) => isMove(x) && x.data.to_date === iso) as (ScheduleEdit & { data: MoveData })[]) {
    const fromDay = dayFromIso(e.date)
    const original = tt.lessonsOn(group, tt.weekOf(fromDay), tt.weekdayOf(fromDay)).find((l) => l.start === e.start)
    if (!original) continue
    base.push({
      ...original,
      weekday,
      start: e.data.to_start,
      end: e.data.to_end,
      room: e.data.room || original.room,
      weeks: [week],
      pair: null,
      cancel: null,
      movedTo: null,
      movedFrom: { date: e.date, start: e.start! },
      added: false,
      notes: e.text ? [e.text] : [],
      subgroup: subgroupOf(original, extras),
    })
  }
  // добавленные
  for (const e of today.filter(isAdd)) {
    base.push({
      group,
      weekday,
      start: e.data.start,
      end: e.data.end,
      subject: e.data.subject,
      kind: e.data.kind ?? null,
      teacher: e.data.teacher ?? null,
      room: e.data.room ?? null,
      weeks: [week],
      pair: null,
      cancel: null,
      movedTo: null,
      movedFrom: null,
      added: true,
      notes: e.text ? [e.text] : [],
      subgroup: e.data.subgroup ? (extras.subgroups.find((s) => s.id === e.data.subgroup) ?? null) : null,
    })
  }

  const starts = new Set(base.map((l) => l.start))
  const notes = today
    .filter((e) => e.kind === 'note' && (e.start === null || !starts.has(e.start)))
    .map((e) => (e.start ? `${e.start} — ${e.text}` : e.text))
  const visible = base.filter((l) => !mine?.length || !l.subgroup || mine.includes(l.subgroup.id))
  visible.sort((a, b) => a.start.localeCompare(b.start))
  return { lessons: visible, notes }
}

// «22.10, 14:35» — куда/откуда перенос
export function shortWhen(iso: string, start: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}, ${start}`
}

// ---------- проверка правки (бот) ----------

const TIME = /^\d{2}:\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export type NewEdit = { groups: string[]; date: string; start: string | null; kind: EditKind; text: string; data: AddData | MoveData | null }

// null — всё хорошо, иначе текст ошибки для человека
export function editProblem(edit: Partial<NewEdit>): string | null {
  if (!edit.groups?.length) return 'Выберите группу'
  if (!edit.date || !DATE.test(edit.date) || Number.isNaN(Date.parse(edit.date))) return 'Выберите дату'
  if (!['cancel', 'note', 'add', 'move'].includes(edit.kind ?? '')) return 'Выберите, что сделать'
  const text = typeof edit.text === 'string' ? edit.text.trim() : ''
  if (text.length > 300) return 'Слишком длинный текст — до 300 символов'
  if (edit.kind === 'add') {
    const d = (edit.data ?? {}) as Partial<AddData>
    if (!d.start || !TIME.test(d.start) || !d.end || !TIME.test(d.end) || d.start >= d.end) return 'Укажите время пары'
    if (!clip(d.subject, 120)) return 'Напишите предмет'
    return null
  }
  if (edit.start !== null && (typeof edit.start !== 'string' || !TIME.test(edit.start))) return 'Выберите пару'
  if ((edit.kind === 'cancel' || edit.kind === 'move') && edit.start === null) return 'Выберите пару'
  if (edit.kind === 'note' && !text) return 'Напишите текст пометки'
  if (edit.kind === 'move') {
    const d = (edit.data ?? {}) as Partial<MoveData>
    if (!d.to_date || !DATE.test(d.to_date)) return 'Выберите, на какой день перенести'
    if (!d.to_start || !TIME.test(d.to_start) || !d.to_end || !TIME.test(d.to_end) || d.to_start >= d.to_end) return 'Выберите новое время'
    if (d.to_date === edit.date && d.to_start === edit.start) return 'Новое время совпадает со старым'
  }
  return null
}

// Только нужные поля данных правки (из запроса)
export function cleanEditData(kind: EditKind, data: unknown): AddData | MoveData | null {
  const d = (data ?? {}) as Record<string, unknown>
  if (kind === 'add') {
    return {
      start: clip(d.start, 5),
      end: clip(d.end, 5),
      subject: clip(d.subject, 120),
      kind: clip(d.kind, 40) || null,
      teacher: clip(d.teacher, 80) || null,
      room: clip(d.room, 30) || null,
      subgroup: typeof d.subgroup === 'number' && Number.isSafeInteger(d.subgroup) ? d.subgroup : null,
    }
  }
  if (kind === 'move') {
    return { to_date: clip(d.to_date, 10), to_start: clip(d.to_start, 5), to_end: clip(d.to_end, 5), room: clip(d.room, 30) || null }
  }
  return null
}

// Правка одной строкой — для админки и «Правок группы»
export function describeEdit(e: ScheduleEdit): string {
  const when = (iso: string, start: string | null) => (start ? shortWhen(iso, start) : `${shortWhen(iso, '').replace(/, $/, '')} (весь день)`)
  switch (e.kind) {
    case 'cancel':
      return `❌ Отмена: ${when(e.date, e.start)}${e.text ? ` — ${e.text}` : ''}`
    case 'note':
      return `📌 ${when(e.date, e.start)}: ${e.text}`
    case 'move': {
      const d = e.data as MoveData | null
      return `↪️ Перенос: ${when(e.date, e.start)} → ${d ? `${shortWhen(d.to_date, d.to_start)}${d.room ? `, ${d.room}` : ''}` : '?'}${e.text ? ` — ${e.text}` : ''}`
    }
    case 'add': {
      const d = e.data as AddData | null
      return `➕ ${d ? `${shortWhen(e.date, d.start)}–${d.end} ${d.subject}${d.room ? `, ${d.room}` : ''}` : e.date}${e.text ? ` — ${e.text}` : ''}`
    }
  }
}
