// «Это не моя пара»: свои скрытые пары. Хранит бот (D1, запись — с проверкой initData), приходят при открытии
// (POST /seen → my_hidden); копия на устройстве — на случай, если бот не ответил. Логика дня — shared/edits-core.ts.
import { callBot } from './api'
import type { HiddenLesson, HideScope } from '../shared/edits-core'
import { readLocal, writeLocal } from './storage'

export type { HiddenLesson, HideScope } from '../shared/edits-core'

const KEY = 'hidden_cache'

export function rememberHidden(list: HiddenLesson[]) {
  writeLocal(KEY, JSON.stringify(list))
}

export function cachedHidden(): HiddenLesson[] {
  try {
    const saved = JSON.parse(readLocal(KEY) ?? 'null') as unknown
    return Array.isArray(saved) ? (saved as HiddenLesson[]) : []
  } catch {
    return []
  }
}

// пара — как её видит человек в этот день (date); бот сам проверит, что она есть у группы
export type HideRequest = { group: string; date: string; start: string; subject: string; kind: string | null; scope: HideScope }

export const hideLesson = (request: HideRequest) => callBot<{ id: number | null; hidden: HiddenLesson[] }>('/hidden/add', request)
export const unhideLesson = (id: number) => callBot<{ hidden: HiddenLesson[] }>('/hidden/delete', { id })
