// Ручные правки расписания из админ-панели: «пара отменена» и пометки (к паре или ко всему дню).
// Приходят от бота при открытии (POST /seen); последнюю копию держим локально — на случай,
// если бот не ответил.
import { readLocal, writeLocal } from './storage'

export type ScheduleEdit = {
  id: number
  group: string
  date: string // ГГГГ-ММ-ДД
  start: string | null
  kind: 'cancel' | 'note'
  text: string
}

const KEY = 'edits_cache'

export function rememberEdits(edits: ScheduleEdit[]) {
  writeLocal(KEY, JSON.stringify(edits))
}

export function cachedEdits(): ScheduleEdit[] {
  try {
    const list = JSON.parse(readLocal(KEY) ?? '[]') as unknown
    return Array.isArray(list) ? (list as ScheduleEdit[]) : []
  } catch {
    return []
  }
}

// Что показать у пары: отмена и пометки
export type LessonEdit = { cancel: ScheduleEdit | null; notes: string[] }
