import { useState } from 'react'
import { MB_IDS, isMbGroup, normalizeGroup } from '../shared/groups'
import { readLocal, save } from './storage'

export type ThemeMode = 'light' | 'system' | 'dark'
export type Role = 'student' | 'teacher'

// group — id группы («b1-mb-mp-1»; раньше хранилось имя «МБ(МП) 1-1» — его понимаем);
// teacher — id преподавателя (роль «Преподаватель»: главный экран — его пары);
// favorites — избранное над расписанием (этап 12): группы и преподаватели («t-<id>») вперемешку, в порядке ленты,
// без ограничения (до MAX_FAVORITES); favAt — когда менялось избранное (копия у бота — D1); favVersion — 2: у МБ
// вторая группа («1-1 / 1-2») уже перенесена в избранное обычным чипом. at — когда менялись настройки (что новее:
// копия на этом устройстве или в облаке Telegram)
export type Prefs = {
  group: string
  theme: ThemeMode
  role: Role
  teacher: string | null
  teacherName: string | null
  favorites: string[]
  favAt: number
  favVersion: number
  subgroups: number[] // свои подгруппы (языки и т. п.) — чужие пары подгрупп не показываем
  at: number
}

const KEY = 'prefs'
const THEMES: ThemeMode[] = ['light', 'system', 'dark']
export const MAX_FAVORITES = 50 // «без ограничения»: столько же принимает бот

// элемент избранного: группа (id или старое имя МБ) или преподаватель «t-<id>»
export const favoriteId = (value: unknown): string | null =>
  typeof value === 'string' && /^t-[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : normalizeGroup(value)

export const cleanFavorites = (list: unknown): string[] =>
  Array.isArray(list) ? [...new Set(list.map(favoriteId).filter((g): g is string => Boolean(g)))].slice(0, MAX_FAVORITES) : []

export const defaultPrefs = (): Prefs => ({
  group: MB_IDS[0],
  theme: 'system',
  role: 'student',
  teacher: null,
  teacherName: null,
  favorites: [],
  favAt: 0,
  favVersion: 1, // у МБ по умолчанию (старые настройки) вторая группа появится в избранном
  subgroups: [],
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
      favorites: cleanFavorites(p.favorites),
      favAt: typeof p.favAt === 'number' ? p.favAt : 0,
      favVersion: typeof p.favVersion === 'number' ? p.favVersion : 1,
      subgroups: Array.isArray(p.subgroups) ? p.subgroups.filter((x): x is number => Number.isSafeInteger(x)) : [],
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

// Этап 12: у МБ(МП) 1-1/1-2 переключатель «1-1 / 1-2» становится обычным чипом ленты — вторая группа один раз
// добавляется в избранное первой (дальше её можно убрать или переставить)
export function migrateFavorites(prefs: Prefs): Prefs {
  if (prefs.favVersion >= 2) return prefs
  const other = prefs.role === 'student' && isMbGroup(prefs.group) ? MB_IDS.find((id) => id !== prefs.group) : undefined
  const favorites = other && !prefs.favorites.includes(other) ? [other, ...prefs.favorites] : prefs.favorites
  return { ...prefs, favorites, favVersion: 2 }
}

export function savePrefs(prefs: Prefs) {
  save(KEY, JSON.stringify(prefs))
}

export const readPrefs = (): Prefs => {
  const parsed = parsePrefs(readLocal(KEY))
  if (!parsed) return migrateFavorites(defaultPrefs())
  const { groupless: _, ...prefs } = parsed
  return migrateFavorites(prefs)
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
