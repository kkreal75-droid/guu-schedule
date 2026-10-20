// Чтение таблицы из файла (CSV или xlsx) — для импорта в админке. xlsx — это zip с XML: распаковываем
// встроенным DecompressionStream, читаем первый лист и общие строки. Без библиотек.

export type Table = string[][]

// ---------- CSV ----------

function parseCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: Table = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean))
}

// ---------- xlsx ----------

type Entry = { name: string; method: number; size: number; offset: number }

function zipEntries(buf: ArrayBuffer): Entry[] {
  const view = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Это не xlsx-файл')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries: Entry[] = []
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    entries.push({ name: decoder.decode(new Uint8Array(buf, p + 46, nameLen)), method, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function readEntry(buf: ArrayBuffer, entry: Entry): Promise<string> {
  const view = new DataView(buf)
  const nameLen = view.getUint16(entry.offset + 26, true)
  const extraLen = view.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLen + extraLen
  const data = new Uint8Array(buf, start, entry.size)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error('Неизвестное сжатие в xlsx')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// число из Excel: время — доля суток (0.375 = 9:00)
const excelValue = (v: string) => {
  const n = Number(v)
  if (Number.isFinite(n) && n > 0 && n < 1 && v.includes('.')) {
    const minutes = Math.round(n * 1440)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  return v
}

async function parseXlsx(buf: ArrayBuffer): Promise<Table> {
  const entries = zipEntries(buf)
  const find = (name: string) => entries.find((e) => e.name === name)
  const sheet = find('xl/worksheets/sheet1.xml') ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
  if (!sheet) throw new Error('В xlsx нет листов')
  const parser = new DOMParser()
  const sharedEntry = find('xl/sharedStrings.xml')
  const shared = sharedEntry
    ? [...parser.parseFromString(await readEntry(buf, sharedEntry), 'application/xml').getElementsByTagName('si')].map((si) =>
        [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
      )
    : []
  const doc = parser.parseFromString(await readEntry(buf, sheet), 'application/xml')
  const table: Table = []
  for (const row of doc.getElementsByTagName('row')) {
    const cells: string[] = []
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') ?? ''
      const type = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      const value =
        type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? (c.getElementsByTagName('t')[0]?.textContent ?? '') : excelValue(v)
      cells[ref ? colIndex(ref) : cells.length] = value.trim()
    }
    if (cells.some(Boolean)) table.push(Array.from(cells, (x) => x ?? ''))
  }
  return table
}

export async function readTable(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer())
  if (/\.xls$/i.test(file.name)) throw new Error('Старый формат .xls не читаю — сохраните как .xlsx или .csv')
  return parseCsv(await file.text())
}

// ---------- занятия секций ----------

export type SportRow = { section: string; weekday: number; start: string; end: string; weeks: string; teacher: string; place: string }

// «пн», «Понедельник», «1» → 0
const WEEKDAYS = [['пн', 'понед'], ['вт', 'вторн'], ['ср', 'сред'], ['чт', 'четв'], ['пт', 'пятн'], ['сб', 'субб'], ['вс', 'воскр']]
const weekdayOf = (v: string) => {
  const s = v.trim().toLowerCase()
  if (/^[1-7]$/.test(s)) return Number(s) - 1
  return WEEKDAYS.findIndex((names) => names.some((n) => s.startsWith(n)))
}

const HEADERS: [keyof SportRow | 'time', RegExp][] = [
  ['section', /секци|назван|вид спорт|дисципл/],
  ['weekday', /день/],
  ['time', /^время$/],
  ['start', /начал|^с$|^от$/],
  ['end', /конец|оконч|^до$/],
  ['teacher', /преподав|тренер|ведущ/],
  ['place', /место|зал|где|корпус/],
  ['weeks', /недел|чётн|четн/],
]

// Таблица → занятия. Первая строка — заголовки (Секция; День; Начало; Конец; Преподаватель; Место; Недели)
export function sportRows(table: Table): { rows: SportRow[]; problems: string[] } {
  const header = (table[0] ?? []).map((h) => h.toLowerCase())
  const col = new Map<string, number>()
  for (const [key, re] of HEADERS) {
    const i = header.findIndex((h, k) => re.test(h) && ![...col.values()].includes(k))
    if (i >= 0) col.set(key, i)
  }
  const problems: string[] = []
  if (!col.has('section') || !col.has('weekday') || !(col.has('time') || (col.has('start') && col.has('end')))) {
    return { rows: [], problems: ['Нужны столбцы: Секция, День, Начало и Конец (или Время «09:00-10:30»)'] }
  }
  const get = (r: string[], key: string) => (col.has(key) ? (r[col.get(key)!] ?? '').trim() : '')
  const rows: SportRow[] = []
  table.slice(1).forEach((r, i) => {
    let start = get(r, 'start')
    let end = get(r, 'end')
    if (col.has('time')) [start, end] = get(r, 'time').split(/\s*[-–—]\s*/)
    const weekday = weekdayOf(get(r, 'weekday'))
    if (weekday < 0) return void problems.push(`строка ${i + 2}: не понял день «${get(r, 'weekday')}»`)
    rows.push({ section: get(r, 'section'), weekday, start: start ?? '', end: end ?? '', weeks: get(r, 'weeks'), teacher: get(r, 'teacher'), place: get(r, 'place') })
  })
  return { rows, problems }
}
