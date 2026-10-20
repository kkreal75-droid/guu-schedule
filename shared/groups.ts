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

// ---------- поиск групп ----------
// «мб 1-1», «МБ(МП)», «гму 2-3», «маркетинг 2», «международный бизнес» — по имени, программе и id.

const squash = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '')
const words = (text: string) => text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean)

export function searchGroups(groups: GroupInfo[], query: string, limit = 20): GroupInfo[] {
  const q = squash(query)
  if (!q) return []
  const qWords = words(query)
  const scored: [number, GroupInfo][] = []
  for (const g of groups) {
    const name = squash(g.name)
    const program = squash(g.program)
    let score = 0
    if (name === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (name.includes(q)) score = 60
    else if (program.startsWith(q)) score = 50
    else if (program.includes(q)) score = 40
    else {
      // «маркетинг 2» — все слова запроса есть в имени, программе или институте (числа — в курсе-номере)
      const hay = `${squash(g.name)} ${squash(g.program)} ${squash(g.institute)} ${g.course}-${g.number}`
      if (qWords.length > 1 && qWords.every((w) => hay.includes(w))) score = 30
    }
    if (score) scored.push([score, g])
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].course - b[1].course || a[1].name.localeCompare(b[1].name, 'ru'))
    .slice(0, limit)
    .map(([, g]) => g)
}

// Подпись к группе в списках: «Международный бизнес · ИУПСиБК · 1 курс»
export const groupSubtitle = (g: GroupInfo) =>
  [g.program, g.institute, g.level === 'postgrad' ? `аспирантура, ${g.course} курс` : `${g.course} курс`].join(' · ')

// Подпись к псевдониму в «Подслушано» (если автор включил): «1 курс, ИУПСиБК», «1 курс маг., ИОМ»,
// «аспирантура, 1 курс» — без группы и программы, чтобы не выдать человека
export const originLabel = (g: Pick<GroupInfo, 'level' | 'course' | 'institute'>) =>
  g.level === 'postgrad'
    ? `аспирантура, ${g.course} курс`
    : `${g.course} курс${g.level === 'master' ? ' маг.' : ''}, ${g.institute}`

// ---------- рассылка: кому ----------

export type AudienceFilter = { level?: Level; form?: Form; course?: number; institute?: string; group?: string }

export function matchGroups(groups: GroupInfo[], f: AudienceFilter): string[] {
  return groups
    .filter(
      (g) =>
        (!f.level || g.level === f.level) &&
        (!f.form || g.form === f.form) &&
        (!f.course || g.course === f.course) &&
        (!f.institute || g.institute === f.institute) &&
        (!f.group || g.id === f.group),
    )
    .map((g) => g.id)
}

export function describeAudience(f: AudienceFilter, groups: GroupInfo[] = []): string {
  if (f.group) return groups.find((g) => g.id === f.group)?.name ?? f.group
  const parts = [
    f.level ? LEVEL_TITLES[f.level].toLowerCase() : null,
    f.form ? (f.form === 'ozfo' ? 'ОЗФО' : 'ОФО') : null,
    f.course ? `${f.course} курс` : null,
    f.institute ?? null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'всем'
}
