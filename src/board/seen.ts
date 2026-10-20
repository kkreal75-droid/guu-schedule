// Точка «есть новое» на «Другом» и «Подслушано»: бот при открытии присылает время последнего сообщения,
// а здесь (localStorage) — до какого времени человек уже видел.
import { readLocal, writeLocal } from '../storage'

const KEY = 'board_seen'

function read(): Record<string, number> {
  try {
    return JSON.parse(readLocal(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function hasNew(latest: Record<string, number> | undefined): boolean {
  const seen = read()
  return Object.entries(latest ?? {}).some(([board, at]) => at > (seen[board] ?? 0))
}

export function markSeen(latest: Record<string, number>) {
  const seen = read()
  for (const [board, at] of Object.entries(latest)) seen[board] = Math.max(seen[board] ?? 0, at)
  writeLocal(KEY, JSON.stringify(seen))
}
