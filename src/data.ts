// Данные всего ГУУ с сайта (public/data/, их пишет update.py): список групп, преподаватели, сессия.
// Списки нужны не при каждом запуске (онбординг, поиск, «Ещё»), поэтому грузятся по требованию и
// держатся в памяти; последняя копия — в localStorage на случай без сети.
import { useEffect, useState } from 'react'
import { normalizeGroup, shortName, type GroupInfo, type GroupsIndex } from '../shared/groups'
import type { TeacherFile } from '../shared/schedule-core'
import { dataUrl } from './schedule'
import { readLocal, writeLocal } from './storage'

export class NotFoundError extends Error {}

async function fetchData<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path), { cache: 'no-store' })
  // GitHub Pages на неизвестный путь отдаёт 404 HTML-страницей
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) throw new NotFoundError(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

// Список с кэшем: в памяти на время сессии + копия в localStorage, если сеть недоступна
export function cachedList<T>(path: string, key: string) {
  let promise: Promise<T> | null = null
  return () =>
    (promise ??= fetchData<T>(path)
      .then((data) => {
        writeLocal(key, JSON.stringify(data))
        return data
      })
      .catch((err) => {
        const saved = readLocal(key)
        promise = null // в следующий раз попробуем снова
        if (saved) return JSON.parse(saved) as T
        throw err
      }))
}

export const loadGroups = cachedList<GroupsIndex>('groups.json', 'groups_index')

export type TeacherInfo = { id: string; name: string; subjects: string[]; groups: string[]; lessons: number }
export const loadTeachers = cachedList<{ updated_at: string; teachers: TeacherInfo[] }>('teachers.json', 'teachers_index')

export const loadTeacher = (id: string) => fetchData<TeacherFile>(`teachers/${id}.json`)

// id → имя группы для списков (МБ — «1-1»); пока список не загрузился — id
export function useGroupNames(): (id: string | null | undefined) => string {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    loadGroups().then((index) => setNames(Object.fromEntries(index.groups.map((g) => [g.id, g.name]))), () => {})
  }, [])
  return (value) => {
    if (!value) return '—'
    const id = normalizeGroup(value) ?? value
    return shortName(id, names[id] ?? id)
  }
}

export async function groupInfo(id: string): Promise<GroupInfo | null> {
  return (await loadGroups()).groups.find((g) => g.id === id) ?? null
}

// ---------- сессия ----------

export type SessionItem = {
  date: string // ГГГГ-ММ-ДД
  until?: string // практика и т. п. на несколько дней
  start: string | null
  end: string | null
  subject: string
  kind: string | null // «Экзамен», «Зачёт», «Консультация»…
  teacher: string | null
  room: string | null
}
export type SessionFile = { id: string; name: string; title: string; items: SessionItem[] }

// Сессия группы; не опубликована — null
export async function loadSession(id: string): Promise<SessionFile | null> {
  try {
    return await fetchData<SessionFile>(`session/${id}.json`)
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

// ---------- поиск преподавателя ----------

const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

// «денисова», «Денисова И», «ден» — по началу фамилии; потом — по вхождению
export function searchTeachers(list: TeacherInfo[], query: string, limit = 30): TeacherInfo[] {
  const q = norm(query).replace(/\./g, '')
  if (q.length < 2) return []
  const name = (t: TeacherInfo) => norm(t.name).replace(/\./g, '')
  const starts = list.filter((t) => name(t).startsWith(q))
  const contains = list.filter((t) => !name(t).startsWith(q) && name(t).includes(q))
  return [...starts, ...contains].slice(0, limit)
}
