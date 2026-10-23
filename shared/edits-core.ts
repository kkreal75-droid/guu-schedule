// Ручные правки расписания поверх файлов ГУУ — общее для приложения, бота и календаря.
//   cancel — пара отменена; note — пометка к паре (start) или ко всему дню (start = null);
//   add — пара добавлена (data: время, предмет, …); move — пара перенесена (data: куда).
// Правки делают владелец (админ-панель) и старосты (только своей группы). Хранятся в D1
// schedule_edits — автообновление их не трогает. Подгруппы (языки и т. п.) — пары, помеченные
// подгруппой, студент видит, только если выбрал её (или не выбрал ни одной).
// «Это не моя пара» — скрытые пары (D1 hidden_lessons): свои — только у себя (приложение, календарь, inline,
// /today в личке), для всей группы (владелец, админ-панель) — у всех, и в беседе группы тоже.
import { dayFromIso, isTeacherKey, isoFromDay, type Audience, type Lesson, type Timetable } from './schedule-core'

export type EditKind = 'cancel' | 'note' | 'add' | 'move'

export type AddData = {
  start: string
  end: string
  subject: string
  kind?: string | null
  teacher?: string | null
  room?: string | null
  subgroup?: number | null
  audience?: Audience[] // только у правок, перенесённых в расписание преподавателя (teacherEdits)
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

// Скрытая пара: день недели, начало, предмет и вид — как в файле ГУУ. day — только в эту дату,
// even / odd — по чётным / нечётным неделям, always — всегда. all — для всей группы (владелец)
export type HideScope = 'day' | 'even' | 'odd' | 'always'
export type HiddenLesson = {
  id: number
  group: string
  weekday: number
  start: string
  subject: string
  kind: string | null
  scope: HideScope
  date: string | null // ГГГГ-ММ-ДД, только у day
  all?: boolean
}
export const HIDE_SCOPES: readonly HideScope[] = ['day', 'even', 'odd', 'always']

// hidden — скрытые для всей группы (у приложения к ним добавляются свои)
export type Extras = { edits: ScheduleEdit[]; subgroups: Subgroup[]; tags: LessonTag[]; hidden?: HiddenLesson[] }
export const NO_EXTRAS: Extras = { edits: [], subgroups: [], tags: [], hidden: [] }

type LessonKey = Pick<Lesson, 'group' | 'weekday' | 'start' | 'subject' | 'kind'>

// Под какое правило пара попадает в этот день (iso, неделя week); null — не скрыта
export function hiddenRule(rules: HiddenLesson[] | undefined, lesson: LessonKey, iso: string, week: number): HiddenLesson | null {
  if (!rules?.length) return null
  return (
    rules.find(
      (h) =>
        h.group === lesson.group &&
        h.weekday === lesson.weekday &&
        h.start === lesson.start &&
        h.subject === lesson.subject &&
        (h.kind ?? null) === (lesson.kind ?? null) &&
        (h.scope === 'always' ||
          (h.scope === 'even' && week % 2 === 0) ||
          (h.scope === 'odd' && week % 2 === 1) ||
          (h.scope === 'day' && h.date === iso)),
    ) ?? null
  )
}

// «по чётным неделям», «только 21.10» — для профиля и админки
export function hideScopeTitle(h: Pick<HiddenLesson, 'scope'> & { date?: string | null }): string {
  if (h.scope === 'day') return h.date ? `только ${h.date.slice(8, 10)}.${h.date.slice(5, 7)}` : 'только в один день'
  return { even: 'по чётным неделям', odd: 'по нечётным неделям', always: 'всегда' }[h.scope]
}

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

// ---------- правки групп в расписании преподавателя (этап 12) ----------
// У пары преподавателя — группы (audience); их правки относятся и к нему: отмена — если отменили все группы пары
// (у потока одна группа может просто не прийти), перенос — если пара у одной группы, пометка — с именем группы,
// добавленная старостой пара с этим преподавателем — тоже его. Считаем один раз на расписание и набор правок.

// i18n-ignore — сравнение ФИО без регистра, пробелов, точек и «ё»
const personKey = (name: string | null | undefined) => (name ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.]/g, '')

const teacherCache = new WeakMap<Timetable, WeakMap<Extras, Map<string, ScheduleEdit[]>>>()

export function teacherEdits(tt: Timetable, group: string, extras: Extras): ScheduleEdit[] {
  let byExtras = teacherCache.get(tt)
  if (!byExtras) teacherCache.set(tt, (byExtras = new WeakMap()))
  let byGroup = byExtras.get(extras)
  if (!byGroup) byExtras.set(extras, (byGroup = new Map()))
  const hit = byGroup.get(group)
  if (hit) return hit

  const own = tt.schedule.lessons.filter((l) => l.group === group)
  const names = new Map(own.flatMap((l) => l.audience ?? []).map((a) => [a.id, a.name]))
  const me = personKey(tt.nameOf(group))
  const out: ScheduleEdit[] = extras.edits.filter((e) => e.group === group)
  // пара преподавателя в этот день и время, у которой есть эта группа
  const lessonAt = (iso: string, start: string | null, of: string) => {
    if (!start) return null
    const day = dayFromIso(iso)
    return tt.lessonsOn(group, tt.weekOf(day), tt.weekdayOf(day)).find((l) => l.start === start && l.audience?.some((a) => a.id === of)) ?? null
  }
  const cancels = new Map<string, Set<string>>() // «дата|время» → какие группы отменили
  for (const e of extras.edits) {
    if (!names.has(e.group)) continue
    if (e.kind === 'add' && isAdd(e)) {
      if (personKey(e.data.teacher) === me) out.push({ ...e, group, data: { ...e.data, audience: [{ id: e.group, name: names.get(e.group)! }] } })
      continue
    }
    const lesson = lessonAt(e.date, e.start, e.group)
    if (!lesson) continue
    const single = (lesson.audience?.length ?? 0) <= 1
    if (e.kind === 'cancel') {
      const key = `${e.date}|${e.start}`
      const set = cancels.get(key) ?? new Set<string>()
      set.add(e.group)
      cancels.set(key, set)
      if (lesson.audience!.every((a) => set.has(a.id))) out.push({ ...e, group })
    } else if (e.kind === 'note') {
      out.push({ ...e, group, text: single ? e.text : `${names.get(e.group)}: ${e.text}` })
    } else if (e.kind === 'move' && single) {
      out.push({ ...e, group })
    }
  }
  byGroup.set(group, out)
  return out
}

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
// (пусто или null — показываем все). Скрытые пары («Это не моя пара», extras.hidden) не показываем;
// перенесённая пара скрыта, если скрыта исходная.
export function dayLessons(tt: Timetable, group: string, day: number, extras: Extras, mine: number[] | null = null): DayView {
  const iso = isoFromDay(day)
  const week = tt.weekOf(day)
  const weekday = tt.weekdayOf(day)
  const edits = isTeacherKey(group) ? teacherEdits(tt, group, extras) : extras.edits.filter((e) => e.group === group)
  const today = edits.filter((e) => e.date === iso)
  const hidden = extras.hidden?.filter((h) => h.group === group)
  const lessons = tt.inSemester(week) ? tt.lessonsOn(group, week, weekday) : []
  const base: DayLesson[] = lessons.filter((l) => !hiddenRule(hidden, l, iso, week)).map((l) => ({
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
    if (!original || hiddenRule(hidden, original, e.date, tt.weekOf(fromDay))) continue
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
    if (hiddenRule(hidden, { group, weekday, start: e.data.start, subject: e.data.subject, kind: e.data.kind ?? null }, iso, week)) continue
    base.push({
      group,
      weekday,
      start: e.data.start,
      end: e.data.end,
      subject: e.data.subject,
      kind: e.data.kind ?? null,
      teacher: e.data.audience ? e.data.audience.map((a) => a.name).join(', ') : (e.data.teacher ?? null),
      room: e.data.room ?? null,
      ...(e.data.audience ? { audience: e.data.audience } : {}),
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
