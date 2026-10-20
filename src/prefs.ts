import { useState } from 'react'
import { MB_IDS, normalizeGroup } from '../shared/groups'
import { readLocal, save } from './storage'

export type ThemeMode = 'light' | 'system' | 'dark'
export type Role = 'student' | 'teacher'

// group — id группы («b1-mb-mp-1»; раньше хранилось имя «МБ(МП) 1-1» — его понимаем);
// teacher — id преподавателя (роль «Преподаватель»: главный экран — его пары);
// favorites — избранные группы (переключатель над расписанием); at — когда менялось (что новее:
// копия на этом устройстве или в облаке Telegram)
export type Prefs = {
  group: string
  theme: ThemeMode
  role: Role
  teacher: string | null
  teacherName: string | null
  favorites: string[]
  at: number
}

const KEY = 'prefs'
const THEMES: ThemeMode[] = ['light', 'system', 'dark']
export const MAX_FAVORITES = 5

export const defaultPrefs = (): Prefs => ({
  group: MB_IDS[0],
  theme: 'system',
  role: 'student',
  teacher: null,
  teacherName: null,
  favorites: [],
  at: 0,
})

// null — настроек нет или они не читаются; groupless — группа не сохранена (старые версии сохраняли
// настройки, только если их меняли)
export function parsePrefs(value: string | null): (Prefs & { groupless: boolean }) | null {
  if (!value) return null
  try {
    const p = JSON.parse(value) as Partial<Prefs>
    const group = normalizeGroup(p.group)
    const base = defaultPrefs()
    return {
      group: group ?? base.group,
      theme: p.theme && THEMES.includes(p.theme) ? p.theme : base.theme,
      role: p.role === 'teacher' && p.teacher ? 'teacher' : 'student',
      teacher: typeof p.teacher === 'string' ? p.teacher : null,
      teacherName: typeof p.teacherName === 'string' ? p.teacherName : null,
      favorites: Array.isArray(p.favorites)
        ? p.favorites.map(normalizeGroup).filter((g): g is string => Boolean(g)).slice(0, MAX_FAVORITES)
        : [],
      at: typeof p.at === 'number' ? p.at : 0,
      groupless: !group && !(p.role === 'teacher' && p.teacher),
    }
  } catch {
    return null
  }
}

// При запуске: копия на устройстве или в облаке Telegram — берём более новую (при равенстве — облако,
// как раньше) и сохраняем на устройстве. Дальше приложение читает только локальную копию.
export function mergeBootPrefs(local: string | null, cloud: string | null) {
  const a = parsePrefs(local)
  const b = parsePrefs(cloud)
  const chosen = !b ? a : !a ? b : a.at > b.at ? a : b
  if (chosen && chosen === b && cloud !== local) save(KEY, cloud!)
  return chosen
}

export function savePrefs(prefs: Prefs) {
  save(KEY, JSON.stringify(prefs))
}

export const readPrefs = (): Prefs => {
  const parsed = parsePrefs(readLocal(KEY))
  if (!parsed) return defaultPrefs()
  const { groupless: _, ...prefs } = parsed
  return prefs
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch, at: Date.now() }
    setPrefs(next)
    savePrefs(next)
  }
  return [prefs, update] as const
}
