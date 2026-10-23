// Расписание преподавателя (этап 12): одна пара у нескольких групп в одно время в одной аудитории (поток,
// лекция) — одна карточка со всеми группами; разные аудитории или предметы в одно время (накладка в файле ГУУ) —
// обе карточки с пометкой «накладка в расписании».
import type { DayLesson } from './edits'
import { toMinutes } from './schedule'

export type ShownLesson = DayLesson & { overlap?: boolean }

const sameSlot = (a: DayLesson, b: DayLesson) =>
  a.start === b.start &&
  a.end === b.end &&
  a.subject === b.subject &&
  (a.kind ?? null) === (b.kind ?? null) &&
  (a.room ?? null) === (b.room ?? null) &&
  Boolean(a.cancel) === Boolean(b.cancel) &&
  Boolean(a.movedTo) === Boolean(b.movedTo)

export function mergeStreams(lessons: DayLesson[]): ShownLesson[] {
  const out: ShownLesson[] = []
  for (const l of lessons) {
    const same = l.audience && out.find((o) => o.audience && sameSlot(o, l))
    if (same) {
      const ids = new Set(same.audience!.map((a) => a.id))
      const audience = [...same.audience!, ...l.audience!.filter((a) => !ids.has(a.id))]
      Object.assign(same, {
        audience,
        teacher: audience.map((a) => a.name).join(', '),
        weeks: [...new Set([...same.weeks, ...l.weeks])].sort((a, b) => a - b),
        notes: [...same.notes, ...l.notes],
      })
      continue
    }
    out.push({ ...l })
  }
  // после склейки всё, что пересекается по времени, — разные пары (аудитория, предмет или вид): накладка
  const live = out.filter((l) => !l.cancel && !l.movedTo)
  for (const a of live) {
    for (const b of live) {
      if (a !== b && toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)) a.overlap = b.overlap = true
    }
  }
  return out
}
