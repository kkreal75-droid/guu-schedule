// Защита входа: размер тела, CORS, лимиты запросов, сравнение секретов в постоянное время.
// Всё здесь — до обращений к D1/KV: лишний запрос отсекается дёшево (только CPU воркера).
//
// Лимиты — Workers Rate Limiting (привязки RL_* в wrangler.jsonc): счётчики живут у Cloudflare, без записей в
// KV/D1 (у KV всего 1000 записей в сутки). Они приблизительные (синхронизация между серверами — секунды), это
// фильтр от флуда, а не бухгалтерия. Ключ — id пользователя Telegram (после проверки подписи) или IP; IP
// у студентов часто общий (Wi-Fi ГУУ за одним NAT), поэтому лимит по IP — щедрый, основной — по пользователю.

export const BODY_LIMIT = 64 * 1024 // обычные запросы приложения
export const WEBHOOK_LIMIT = 1024 * 1024 // обновления Telegram
export const ADMIN_LIMIT = 12 * 1024 * 1024 // админка: фото рассылки (до 8 МБ) в base64

const encoder = new TextEncoder()

// Тело запроса не больше max байт; больше — 413 без разбора
export async function readBody(request: Request, max: number): Promise<string | Response> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > max) return tooLarge()
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const tooLarge = () => Response.json({ ok: false, error: 'too-large' }, { status: 413 })
export const tooMany = () =>
  Response.json({ ok: false, error: 'rate' }, { status: 429, headers: { 'Retry-After': '30' } })

// ---------- лимиты ----------

export type Limiter = 'RL_IP' | 'RL_USER' | 'RL_WRITE' | 'RL_SEEN' | 'RL_BOT' | 'RL_PUBLIC' | 'RL_SETUP'

// true — можно. Привязки нет или сбой — пропускаем (лимит не должен ронять приложение)
export async function allow(env: Env, limiter: Limiter, key: string | number): Promise<boolean> {
  const binding = (env as unknown as Record<string, RateLimit | undefined>)[limiter]
  if (!binding) return true
  try {
    return (await binding.limit({ key: String(key) })).success
  } catch {
    return true
  }
}

export const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'unknown'

// ---------- сравнение секретов ----------

// В постоянное время (не выдаёт по времени ответа, сколько символов совпало)
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  if (x.byteLength !== y.byteLength) return false
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean }
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(x, y)
  let diff = 0
  for (let i = 0; i < x.byteLength; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

// ---------- CORS ----------

// Приватные эндпоинты — только для origin мини-приложения (WEBAPP_URL); календарь и вебхук CORS не нужен
export function withCors(env: Env, request: Request, response: Response): Response {
  const app = new URL(env.WEBAPP_URL).origin
  const origin = request.headers.get('Origin')
  const headers = new Headers(response.headers)
  headers.delete('Access-Control-Allow-Origin')
  if (origin === app) {
    headers.set('Access-Control-Allow-Origin', app)
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  headers.append('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

// ---------- кэш публичных ответов ----------

// В памяти изолята + ETag: повторный запрос того же содержимого — 304 без тела. Изоляты у маленького
// воркера живут долго, поэтому D1 читается раз в ttl, а не на каждый запрос.
type Cached = { at: number; body: string; etag: string }
const memory = new Map<string, Cached>()

async function etagOf(body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', encoder.encode(body)))
  return `"${[...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`
}

export async function cachedJson(
  request: Request,
  key: string,
  ttlMs: number,
  load: () => Promise<unknown>,
  maxAge = 60,
): Promise<Response> {
  let hit = memory.get(key)
  if (!hit || Date.now() - hit.at > ttlMs) {
    const body = JSON.stringify(await load())
    hit = { at: Date.now(), body, etag: await etagOf(body) }
    memory.set(key, hit)
    if (memory.size > 500) memory.delete(memory.keys().next().value!)
  }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${maxAge}`,
    ETag: hit.etag,
  }
  if (request.headers.get('If-None-Match') === hit.etag) return new Response(null, { status: 304, headers })
  return new Response(hit.body, { headers })
}

// Владелец поправил данные — забыть кэш (в этом изоляте; в остальных — через ttl)
export const forgetCached = (key: string) => void memory.delete(key)
