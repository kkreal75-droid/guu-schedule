import { useEffect, useRef, useState } from 'react'
import { normalizeGroup } from '../shared/groups'
import { schedule } from './schedule'
import { readCloud, readLocal, save } from './storage'

export type ThemeMode = 'light' | 'system' | 'dark'
// group — id группы («b1-mb-mp-1»); раньше хранилось имя («МБ(МП) 1-1») — его понимаем
export type Prefs = { group: string; theme: ThemeMode }

const KEY = 'prefs'
const THEMES: ThemeMode[] = ['light', 'system', 'dark']
// функция, а не константа: schedule заполняется только после загрузки schedule.json
const defaults = (): Prefs => ({ group: schedule.groups[0], theme: 'system' })

function parse(value: string | null): Prefs | null {
  if (!value) return null
  try {
    const p = JSON.parse(value) as Partial<Prefs>
    const group = normalizeGroup(p.group)
    return {
      group: group && schedule.groups.includes(group) ? group : defaults().group,
      theme: p.theme && THEMES.includes(p.theme) ? p.theme : defaults().theme,
    }
  } catch {
    return null
  }
}

// Настройки: сразу берём локальную копию (без мигания темы), потом подтягиваем из CloudStorage.
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => parse(readLocal(KEY)) ?? defaults())
  const touched = useRef(false)

  useEffect(() => {
    readCloud(KEY).then((value) => {
      const cloud = parse(value)
      // если пользователь уже что-то поменял, пока шёл запрос, — его выбор важнее
      if (cloud && !touched.current) {
        setPrefs(cloud)
        save(KEY, JSON.stringify(cloud))
      }
    })
  }, [])

  const update = (patch: Partial<Prefs>) => {
    touched.current = true
    const next = { ...prefs, ...patch }
    setPrefs(next)
    save(KEY, JSON.stringify(next))
  }

  return [prefs, update] as const
}
