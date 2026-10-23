// Общее для тестов: подписанный initData, запросы к воркеру, подмена Telegram и сайта (в сеть не ходим).
import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { vi } from 'vitest'
import groups from '../../public/data/groups.json'
import mb11 from '../../public/data/schedule/b1-mb-mp-1.json'
import mb12 from '../../public/data/schedule/b1-mb-mp-2.json'
import gmu1 from '../../public/data/schedule/b1-gmu-1.json'
import teachers from '../../public/data/teachers.json'
import teacherMine from '../../public/data/teachers/ahremchik-d-v.json'
import teacherOther from '../../public/data/teachers/adamova-g-a.json'
import overrides from '../../overrides.json'
import thursday11 from '../../overrides/thursday.json'
import thursday12 from '../../overrides/thursday-1-2.json'
import subjectsEn from '../../data/i18n/subjects.en.json'
import guuEn from '../../data/i18n/guu.en.json'

// мероприятия make.events (этап 13): не настоящий events.json (он меняется каждый час) — свои, с «плохими» символами
export const EVENTS = {
  source: 'https://make.events/community/cPsmzW/public/events',
  updated_at: '2026-10-23T12:00:00+03:00',
  events: [
    { id: 'aaa111', title: 'Кейс-клуб; встреча, первая', start: '2026-10-29T10:40', end: null, place: 'У-452', description: 'Строка 1\nСтрока 2', url: 'https://guu.make.events/eventsNew/aaa111' },
    { id: 'bbb222', title: 'Взлом\r\nBEGIN:VEVENT\r\nSUMMARY:x', start: '2026-10-29T10:40', end: '2026-10-29T12:10', place: null, description: '', url: 'https://evil.example/x' },
    { id: 'ccc333', title: 'Нетворкинг', start: '2026-10-29T16:00', end: null, place: 'ЦИТ-211', description: 'Описание', url: 'https://guu.make.events/eventsNew/ccc333' },
    { id: 'ddd444', title: 'Пятница', start: '2026-10-30T12:00', end: null, place: null, description: '', url: 'https://guu.make.events/eventsNew/ddd444' },
  ],
}

export const OWNER = 7
export const MINE_TEACHER = 'ahremchik-d-v' // ведёт у МБ(МП) 1-1
export const OTHER_TEACHER = 'adamova-g-a' // у МБ не ведёт
const TOKEN = (env as unknown as { BOT_TOKEN: string }).BOT_TOKEN

const SITE: Record<string, unknown> = {
  '/data/groups.json': groups,
  '/data/schedule/b1-mb-mp-1.json': mb11,
  '/data/schedule/b1-mb-mp-2.json': mb12,
  '/data/schedule/b1-gmu-1.json': gmu1,
  '/data/teachers.json': teachers,
  '/data/teachers/ahremchik-d-v.json': teacherMine,
  '/data/teachers/adamova-g-a.json': teacherOther,
  '/overrides.json': overrides,
  '/overrides/thursday.json': thursday11,
  '/overrides/thursday-1-2.json': thursday12,
  '/data/i18n/subjects.en.json': subjectsEn,
  '/data/i18n/guu.en.json': guuEn,
  '/data/events.json': EVENTS,
}

// что воркер отправил в Telegram — для проверок
export const telegramCalls: { method: string; body: unknown }[] = []

// вебхук в поддельном Telegram: по умолчанию — наш адрес из конфигурации; setWebhook не по https отклоняется
// и оставляет вебхук пустым
const ALL_UPDATES = ['message', 'callback_query', 'inline_query', 'my_chat_member']
const WEBHOOK = (env as unknown as { WEBHOOK_URL: string }).WEBHOOK_URL
export const telegramState: { webhook: Record<string, unknown> } = { webhook: {} }
export function resetWebhook(patch: Record<string, unknown> = {}) {
  telegramState.webhook = { url: WEBHOOK, has_custom_certificate: false, pending_update_count: 0, allowed_updates: ALL_UPDATES, ...patch }
}
resetWebhook()

export function mockOutbound() {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    if (url.host === 'tg.test') {
      const method = url.pathname.split('/').pop()!
      const text = await request.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        // multipart (sendDocument) — оставляем текстом
      }
      telegramCalls.push({ method, body })
      if (method === 'getWebhookInfo') return Response.json({ ok: true, result: telegramState.webhook })
      if (method === 'setWebhook') {
        const { url: hook, allowed_updates } = body as { url: string; allowed_updates?: string[] }
        if (!/^https:\/\//.test(hook)) {
          telegramState.webhook = { ...telegramState.webhook, url: '' }
          return Response.json({ ok: false, error_code: 400, description: 'Bad Request: bad webhook: An HTTPS URL must be provided for webhook' }, { status: 400 })
        }
        telegramState.webhook = { ...telegramState.webhook, url: hook, allowed_updates: allowed_updates ?? ALL_UPDATES, last_error_date: undefined, last_error_message: undefined }
        return Response.json({ ok: true, result: true })
      }
      const result =
        method === 'getChatMember' ? { status: 'member' } : method === 'getMe' ? { username: 'GUU_Scheduule_bot' } : { message_id: 1 }
      return Response.json({ ok: true, result })
    }
    if (url.host === 'site.test') {
      const data = SITE[url.pathname]
      return data ? Response.json(data) : new Response('not found', { status: 404 })
    }
    if (url.host === 'bot.test') return real(input, init)
    return new Response('outbound blocked in tests', { status: 599 })
  })
}

const encoder = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, encoder.encode(data))
}

// initData так, как его подписывает Telegram (или испорченный / просроченный — для тестов)
export async function initData(id: number, opts: { name?: string; authDate?: number; tamper?: boolean } = {}) {
  const params = new URLSearchParams({
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: 'q',
    user: JSON.stringify({ id, first_name: opts.name ?? 'Тест', username: `u${id}` }),
  })
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = await hmac(encoder.encode('WebAppData'), TOKEN)
  let hash = hex(await hmac(secret, check))
  if (opts.tamper) hash = (hash[0] === 'a' ? 'b' : 'a') + hash.slice(1)
  params.set('hash', hash)
  return params.toString()
}

let nextId = 1_000_000
export const newUser = () => nextId++

export function call(path: string, init: RequestInit = {}) {
  return exports.default.fetch(new Request(`https://bot.test${path}`, init))
}

export const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers })

export async function postAs(id: number, path: string, body: Record<string, unknown> = {}) {
  return post(path, { initData: await initData(id), ...body })
}

export async function webhookSecret() {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(`webhook:${TOKEN}`)))
}

export async function sendUpdate(update: Record<string, unknown>, secret?: string) {
  return post('/webhook', update, { 'X-Telegram-Bot-Api-Secret-Token': secret ?? (await webhookSecret()) })
}

export const sql = (query: string, ...params: unknown[]) => env.DB.prepare(query).bind(...params)

// воркер обрабатывает обновления Telegram в фоне — ждём, пока появится результат
export async function eventually<T>(check: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > until) throw new Error('не дождались')
    await new Promise((r) => setTimeout(r, 50))
  }
}
