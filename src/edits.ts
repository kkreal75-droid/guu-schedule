// Ручные правки расписания (владелец и старосты), подгруппы и пометки пар подгрупп.
// Приходят от бота при открытии (POST /seen) — только для групп, которые показывает приложение;
// последнюю копию держим локально — на случай, если бот не ответил. Логика — shared/edits-core.ts.
import { NO_EXTRAS, type Extras } from '../shared/edits-core'
import { readLocal, writeLocal } from './storage'

export type { DayLesson, Extras, ScheduleEdit, Subgroup } from '../shared/edits-core'

const KEY = 'extras_cache'

export function rememberExtras(extras: Extras) {
  writeLocal(KEY, JSON.stringify(extras))
}

export function cachedExtras(): Extras {
  try {
    const saved = JSON.parse(readLocal(KEY) ?? 'null') as Partial<Extras> | null
    if (!saved) return NO_EXTRAS
    return {
      edits: Array.isArray(saved.edits) ? saved.edits : [],
      subgroups: Array.isArray(saved.subgroups) ? saved.subgroups : [],
      tags: Array.isArray(saved.tags) ? saved.tags : [],
    }
  } catch {
    return NO_EXTRAS
  }
}
