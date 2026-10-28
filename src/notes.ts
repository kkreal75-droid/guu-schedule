import { useEffect, useState } from 'react'
import { mbName } from '../shared/groups'
import { dateOf } from './format'
import type { Lesson } from './schedule'
import { cloudAvailable, cloudGetMany, cloudKeys, cloudRemove, cloudSet, readLocal, writeLocal } from './storage'

// Заметки живут в Telegram CloudStorage — по одному ключу на заметку.
// Ключи: только [A-Za-z0-9_-], до 128 символов; значение — до 4096 символов; всего до 1024 ключей.
//   nd_20261022                — заметка к дню
//   np_20261022_0900_<группа>  — заметка к паре (группа — короткий хэш названия)

export type Notes = Record<string, string>

export const NOTE_MAX = 4000

const DAY_PREFIX = 'nd_'
const LESSON_PREFIX = 'np_'
const isNoteKey = (key: string) => key.startsWith(DAY_PREFIX) || key.startsWith(LESSON_PREFIX)

const pad = (n: number) => String(n).padStart(2, '0')
function ymd(day: number) {
  const { year, month, date } = dateOf(day)
  return `${year}${pad(month + 1)}${pad(date)}`
}

// FNV-1a: из группы — стабильный короткий ASCII-идентификатор для ключа. У МБ(МП) 1-1/1-2 ключ
// считается, как раньше, от имени («МБ(МП) 1-1»): так их старые заметки к парам на месте.
function groupSlug(id: string) {
  const group = mbName(id) ?? id
  let h = 0x811c9dc5
  for (const ch of group) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export const dayNoteKey = (day: number) => `${DAY_PREFIX}${ymd(day)}`

export const lessonNoteKey = (day: number, group: string, lesson: Lesson) =>
  `${LESSON_PREFIX}${ymd(day)}_${lesson.start.replace(':', '')}_${groupSlug(group)}`

// Есть ли на этот день заметка к дню или к парам этой группы
export function dayHasNotes(notes: Notes, day: number, group: string) {
  const date = ymd(day)
  if (notes[`${DAY_PREFIX}${date}`]) return true
  const prefix = `${LESSON_PREFIX}${date}_`
  const suffix = `_${groupSlug(group)}`
  return Object.keys(notes).some((key) => key.startsWith(prefix) && key.endsWith(suffix))
}

// ---------- локальная копия ----------
// Нужна, чтобы заметки показывались сразу при запуске и не терялись, если запись в облако
// не прошла (нет сети). pending: ключ → метка правки, ещё не подтверждённой облаком.

type Cache = { notes: Notes; pending: Record<string, number> }
const CACHE_KEY = 'notes_cache'

function readCache(): Cache {
  try {
    const cache = JSON.parse(readLocal(CACHE_KEY) ?? '') as Partial<Cache>
    return { notes: cache.notes ?? {}, pending: cache.pending ?? {} }
  } catch {
    return { notes: {}, pending: {} }
  }
}

const writeCache = (cache: Cache) => writeLocal(CACHE_KEY, JSON.stringify(cache))

async function push(key: string, value: string | undefined, stamp: number) {
  const ok = value ? await cloudSet(key, value) : await cloudRemove(key)
  if (!ok) return // останется в pending — повторим при следующем запуске
  const cache = readCache()
  // снимаем отметку, только если за это время не было более новой правки
  if (cache.pending[key] === stamp) {
    delete cache.pending[key]
    writeCache(cache)
  }
}

export function useNotes() {
  const [notes, setNotes] = useState<Notes>(() => readCache().notes)

  useEffect(() => {
    if (!cloudAvailable()) return
    let cancelled = false
    ;(async () => {
      const keys = await cloudKeys()
      const cloud = keys && (await cloudGetMany(keys.filter(isNoteKey)))
      if (!cloud || cancelled) return
      // облако — источник правды (там правки с других устройств),
      // кроме локальных правок, которые до облака ещё не дошли
      const cache = readCache()
      const merged: Notes = {}
      for (const [key, value] of Object.entries(cloud)) if (value) merged[key] = value
      for (const [key, stamp] of Object.entries(cache.pending)) {
        if (cache.notes[key]) merged[key] = cache.notes[key]
        else delete merged[key]
        push(key, cache.notes[key], stamp)
      }
      writeCache({ notes: merged, pending: cache.pending })
      setNotes(merged)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setNote = (key: string, text: string) => {
    const value = text.trim().slice(0, NOTE_MAX)
    const cache = readCache()
    if ((cache.notes[key] ?? '') === value) return
    if (value) cache.notes[key] = value
    else delete cache.notes[key]
    const stamp = Date.now()
    const synced = cloudAvailable()
    if (synced) cache.pending[key] = stamp
    writeCache(cache)
    setNotes({ ...cache.notes })
    if (synced) push(key, value || undefined, stamp)
  }

  return { notes, setNote }
}
