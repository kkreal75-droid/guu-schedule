// Группы ГУУ — общее для мини-приложения (src/) и бота (bot/).
// У каждой группы стабильный id (реестр data/group_ids.json, его ведёт update.py) и читаемое имя.
// С МБ(МП) 1-1 и 1-2 всё начиналось: раньше их хранили по имени («МБ(МП) 1-1») — такие значения
// ещё могут прийти от старых версий приложения, из старых записей и настроек бесед; понимаем их.

export const MB_GROUPS = [
  { id: 'b1-mb-mp-1', name: 'МБ(МП) 1-1', short: '1-1' },
  { id: 'b1-mb-mp-2', name: 'МБ(МП) 1-2', short: '1-2' },
] as const

export const MB_IDS: string[] = MB_GROUPS.map((g) => g.id)

// старое имя → id
const LEGACY: Record<string, string> = Object.fromEntries(MB_GROUPS.map((g) => [g.name, g.id]))

export const isMbGroup = (id: string | null | undefined) => Boolean(id && MB_IDS.includes(id))

// id группы: латиница, цифры, дефисы — «b1-mb-mp-1», «m2-umb-angl-1», «a1-5-2-4»
export const GROUP_ID = /^[a-z][a-z0-9-]{1,63}$/

// Значение из запроса или базы → id (старое имя МБ понимаем); мусор — null
export function normalizeGroup(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (LEGACY[trimmed]) return LEGACY[trimmed]
  return GROUP_ID.test(trimmed) ? trimmed : null
}

// «1-1» для МБ (так их все и зовут), иначе — полное имя
export function shortName(id: string, name?: string | null): string {
  return MB_GROUPS.find((g) => g.id === id)?.short ?? name ?? id
}

export const mbName = (id: string): string | null => MB_GROUPS.find((g) => g.id === id)?.name ?? null

// ---------- groups.json (update.py) ----------

export type Level = 'bachelor' | 'master' | 'postgrad'
export type Form = 'ofo' | 'ozfo'

export type GroupInfo = {
  id: string
  name: string
  level: Level
  form: Form
  course: number
  institute: string // короткое: «ИУПСиБК»
  direction: string
  program: string
  number: string
  lessons: number
  session: boolean // есть ли расписание сессии текущего учебного года
  updated_at?: string
  source_file?: string
}

export type GroupsIndex = {
  updated_at: string
  semester_start: string
  institutes: Record<string, string> // короткое → полное
  groups: GroupInfo[]
}

export const LEVEL_TITLES: Record<Level, string> = { bachelor: 'Бакалавриат', master: 'Магистратура', postgrad: 'Аспирантура' }
export const FORM_TITLES: Record<Form, string> = { ofo: 'Очная', ozfo: 'Очно-заочная' }
