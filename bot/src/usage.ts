// Расход бесплатных лимитов Cloudflare и «предохранитель».
//
// Воркер сам считает свои запросы, строки D1 (meta.rows_read / rows_written) и операции KV — в памяти изолята,
// и раз в 5 минут (или каждые 1000 запросов) прибавляет их к D1 usage_daily одним запросом. Сутки — по UTC, как
// у лимитов Cloudflare. Cron раз в 10 минут сверяет сумму с лимитами: на 80% — тревога владельцу в бот (раз в
// сутки на метрику) и «режим экономии»: визиты не пишутся, чат опрашивается реже, .ics дольше в кэше — расписание
// продолжает работать. Это оценка снизу (запросы, отбитые до кода, сюда не попадают), но для тревоги хватает.
import { sendMessage } from './telegram'

type Metric = 'requests' | 'd1_read' | 'd1_write' | 'kv_read' | 'kv_write'

// бесплатный тариф Workers / D1 / KV, в сутки
export const FREE_LIMITS: Record<Metric, number> = {
  requests: 100_000,
  d1_read: 5_000_000,
  d1_write: 100_000,
  kv_read: 100_000,
  kv_write: 1_000,
}
const TITLES: Record<Metric, string> = {
  requests: 'запросы к воркеру',
  d1_read: 'чтение D1 (строки)',
  d1_write: 'запись D1 (строки)',
  kv_read: 'чтение KV',
  kv_write: 'запись KV',
}
const ALARM = 0.8

const counters: Record<Metric, number> = { requests: 0, d1_read: 0, d1_write: 0, kv_read: 0, kv_write: 0 }
const FLUSH_MS = 5 * 60_000
let lastFlush = Date.now()
let economy = false

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10)

export const countRequest = () => void counters.requests++
export const economyMode = () => economy

// ---------- учёт D1 и KV ----------

type Meta = { rows_read?: number; rows_written?: number } | undefined
const addMeta = (meta: Meta) => {
  counters.d1_read += meta?.rows_read ?? 0
  counters.d1_write += meta?.rows_written ?? 0
}

// statement-обёртка → настоящий statement (batch принимает только настоящие)
const originals = new WeakMap<object, D1PreparedStatement>()

function meterStatement(stmt: D1PreparedStatement): D1PreparedStatement {
  const proxy = new Proxy(stmt, {
    get(target, prop) {
      if (prop === 'bind') return (...args: unknown[]) => meterStatement(target.bind(...args))
      if (prop === 'run' || prop === 'all') {
        return async () => {
          const result = await target.all()
          addMeta(result.meta as Meta)
          return result
        }
      }
      // first() у D1 тоже выполняет весь запрос — берём all(), чтобы увидеть meta
      if (prop === 'first') {
        return async (column?: string) => {
          const result = await target.all<Record<string, unknown>>()
          addMeta(result.meta as Meta)
          const row = result.results[0] ?? null
          return column === undefined ? row : row ? (row[column] ?? null) : null
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  originals.set(proxy, stmt)
  return proxy
}

function meterD1(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => meterStatement(target.prepare(sql))
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((s) => originals.get(s) ?? s))
          for (const r of results) addMeta(r.meta as Meta)
          return results
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function meterKV(kv: KVNamespace): KVNamespace {
  return new Proxy(kv, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'get' || prop === 'getWithMetadata' || prop === 'list') {
        return (...args: unknown[]) => (counters.kv_read++, (value as (...a: unknown[]) => unknown).apply(target, args))
      }
      if (prop === 'put' || prop === 'delete') {
        return (...args: unknown[]) => (counters.kv_write++, (value as (...a: unknown[]) => unknown).apply(target, args))
      }
      return value.bind(target)
    },
  })
}

// env с подсчётом D1 и KV — один раз на запрос / запуск cron
const metered = new WeakMap<object, Env>()
export function meterEnv(env: Env): Env {
  const known = metered.get(env)
  if (known) return known
  const wrapped = { ...env, DB: meterD1(env.DB), KV: meterKV(env.KV) } as Env
  metered.set(env, wrapped)
  metered.set(wrapped, wrapped)
  return wrapped
}

// ---------- сброс в D1 ----------

// Прибавляет накопленное к usage_daily и заодно узнаёт, включён ли режим экономии (1 запрос к D1)
export async function flushUsage(env: Env, force = false): Promise<void> {
  const pending = Object.values(counters).some((n) => n > 0)
  if (!force && (!pending || (Date.now() - lastFlush < FLUSH_MS && counters.requests < 1000))) return
  const day = utcDay()
  const snapshot = { ...counters }
  for (const key of Object.keys(counters) as Metric[]) counters[key] = 0
  lastFlush = Date.now()
  const rows = (Object.keys(snapshot) as Metric[]).filter((m) => snapshot[m] > 0)
  try {
    const statements: D1PreparedStatement[] = []
    if (rows.length) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO usage_daily (day, metric, n) SELECT ?1, key, value FROM json_each(?2) WHERE true
           ON CONFLICT (day, metric) DO UPDATE SET n = n + excluded.n`,
        ).bind(day, JSON.stringify(Object.fromEntries(rows.map((m) => [m, snapshot[m]])))),
      )
    }
    statements.push(env.DB.prepare(`SELECT n FROM usage_daily WHERE day = ? AND metric = 'economy'`).bind(day))
    const results = await env.DB.batch(statements)
    economy = Boolean((results.at(-1)!.results[0] as { n?: number } | undefined)?.n)
  } catch (err) {
    // не получилось — вернём счётчики, прибавим в следующий раз
    for (const m of rows) counters[m] += snapshot[m]
    console.error('Учёт лимитов:', err)
  }
}

export type UsageToday = { day: string; values: Record<Metric, number>; economy: boolean }

export async function usageToday(env: Env): Promise<UsageToday> {
  const day = utcDay()
  const { results } = await env.DB.prepare('SELECT metric, n FROM usage_daily WHERE day = ?').bind(day).all<{ metric: string; n: number }>()
  const map = new Map(results.map((r) => [r.metric, r.n]))
  const values = Object.fromEntries((Object.keys(FREE_LIMITS) as Metric[]).map((m) => [m, map.get(m) ?? 0])) as Record<Metric, number>
  return { day, values, economy: Boolean(map.get('economy')) }
}

export function usageText(usage: UsageToday): string {
  const lines = (Object.keys(FREE_LIMITS) as Metric[]).map((m) => {
    const pct = Math.round((usage.values[m] / FREE_LIMITS[m]) * 100)
    return `${pct >= ALARM * 100 ? '🔴' : pct >= 50 ? '🟡' : '🟢'} ${TITLES[m]}: ${usage.values[m].toLocaleString('ru-RU')} из ${FREE_LIMITS[m].toLocaleString('ru-RU')} (${pct}%)`
  })
  return [
    `📊 <b>Расход бесплатных лимитов</b> · ${usage.day} (UTC)`,
    ...lines,
    usage.economy ? '\n🪫 Включён режим экономии до конца суток (03:00 МСК).' : '',
    '\nОценка снизу: запросы, отбитые до кода воркера, сюда не попадают.',
  ].join('\n')
}

// Cron: сверка с лимитами — тревога владельцу и режим экономии (на 80% любой метрики)
export async function checkBudget(env: Env): Promise<number> {
  await flushUsage(env, true)
  const usage = await usageToday(env)
  const hot = (Object.keys(FREE_LIMITS) as Metric[]).filter((m) => usage.values[m] >= FREE_LIMITS[m] * ALARM)
  if (!hot.length) return 2
  const statements = [
    env.DB.prepare(`INSERT INTO usage_daily (day, metric, n) VALUES (?, 'economy', 1) ON CONFLICT (day, metric) DO UPDATE SET n = 1`).bind(usage.day),
    ...hot.map((m) => env.DB.prepare(`INSERT OR IGNORE INTO usage_daily (day, metric, n) VALUES (?, ?, 1)`).bind(usage.day, `alert:${m}`)),
  ]
  const results = await env.DB.batch(statements)
  economy = true
  const fresh = hot.filter((_, i) => results[i + 1].meta.changes > 0)
  if (fresh.length && env.OWNER_ID) {
    await sendMessage(
      env,
      Number(env.OWNER_ID),
      `⚠️ <b>Лимиты Cloudflare на исходе</b>: ${fresh.map((m) => TITLES[m]).join(', ')} — больше ${ALARM * 100}%.\n` +
        'Включён режим экономии: визиты не пишутся, чат обновляется реже, календари — из кэша. Расписание работает.\n\n' +
        usageText({ ...usage, economy: true }),
    )
  }
  return 4
}
