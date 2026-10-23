// Вебхук: адрес — только из конфигурации, настройку запускают владелец и cron, публичного адреса нет;
// присмотр cron, проверка после деплоя, ошибки владельцу — не чаще раза в час.
import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OWNER, call, eventually, mockOutbound, newUser, postAs, resetWebhook, sendUpdate, telegramCalls, telegramState } from './helpers'
import { afterDeploy, watchWebhook, webhookUrl } from '../src/setup'
import { reportError } from '../src/errors'

const E = env as unknown as Env
const WEBHOOK = E.WEBHOOK_URL
const sent = (method: string) => telegramCalls.filter((c) => c.method === method)
const toOwner = () => sent('sendMessage').filter((c) => (c.body as { chat_id: number }).chat_id === OWNER).map((c) => (c.body as { text: string }).text)

beforeAll(() => mockOutbound())
beforeEach(async () => {
  resetWebhook()
  telegramCalls.length = 0
  await E.KV.delete('webhook-alert')
})

describe('настройка бота не публичная', () => {
  it('GET / (и по http, и с ?force) — 404, вебхук не трогается', async () => {
    for (const path of ['/', '/?force']) {
      expect((await call(path)).status).toBe(404)
    }
    const http = await (await import('cloudflare:workers')).exports.default.fetch(new Request('http://bot.test/?force'))
    expect(http.status).toBe(404)
    expect(sent('setWebhook')).toHaveLength(0)
    expect(sent('getWebhookInfo')).toHaveLength(0)
    expect(telegramState.webhook.url).toBe(WEBHOOK)
  })

  it('адрес вебхука — только https://…/webhook из конфигурации', () => {
    expect(webhookUrl(E)).toBe('https://guu-schedule-bot.guu-schedule-bot.workers.dev/webhook')
    for (const bad of ['', 'http://x.workers.dev/webhook', 'https://x.workers.dev/', 'https://x.workers.dev/webhook?x=1', 'nonsense']) {
      expect(() => webhookUrl({ ...E, WEBHOOK_URL: bad } as unknown as Env)).toThrow(/WEBHOOK_URL/)
    }
  })

  it('админ-панель: состояние и «Переустановить» — только владельцу', async () => {
    expect((await postAs(newUser(), '/admin/bot-status')).status).toBe(403)
    expect((await postAs(newUser(), '/admin/bot-setup')).status).toBe(403)
    resetWebhook({ url: '' })
    const status = await (await postAs(OWNER, '/admin/bot-status')).json<{ url_ok: boolean; url: string }>()
    expect(status).toMatchObject({ url_ok: false, url: '' })
    const fixed = await (await postAs(OWNER, '/admin/bot-setup')).json<{ url_ok: boolean; url: string }>()
    expect(fixed).toMatchObject({ url_ok: true, url: WEBHOOK })
    const hook = sent('setWebhook').at(-1)!.body as { url: string; secret_token: string; drop_pending_updates?: boolean }
    expect(hook.url).toBe(WEBHOOK)
    expect(hook.secret_token).toMatch(/^[0-9a-f]{64}$/)
    expect(hook.drop_pending_updates).toBeUndefined()
  })

  it('/webhook — у владельца состояние, у остальных молчит', async () => {
    await sendUpdate({ update_id: 880_001, message: { message_id: 1, date: 0, text: '/webhook', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'В' } } })
    await eventually(async () => toOwner().some((t) => t.includes('Вебхук') && t.includes('на месте')))
    const stranger = newUser()
    await sendUpdate({ update_id: 880_002, message: { message_id: 2, date: 0, text: '/webhook', chat: { id: stranger, type: 'private' }, from: { id: stranger, first_name: 'Ч' } } })
    await new Promise((r) => setTimeout(r, 300))
    expect(sent('sendMessage').some((c) => (c.body as { chat_id: number }).chat_id === stranger)).toBe(false)
  })
})

describe('присмотр за вебхуком (cron)', () => {
  it('всё в порядке — молчит', async () => {
    expect(await watchWebhook(E)).toBe(1)
    expect(toOwner()).toHaveLength(0)
    expect(sent('setWebhook')).toHaveLength(0)
  })

  it('сброшен — ставит заново (без сброса очереди) и пишет владельцу; повтор в течение 30 минут — без тревоги', async () => {
    resetWebhook({ url: '', pending_update_count: 8 })
    await watchWebhook(E)
    expect(telegramState.webhook.url).toBe(WEBHOOK)
    expect((sent('setWebhook')[0].body as { drop_pending_updates?: boolean }).drop_pending_updates).toBeUndefined()
    expect(toOwner()).toHaveLength(1)
    expect(toOwner()[0]).toContain('сброшен')
    resetWebhook({ url: '' })
    await watchWebhook(E)
    expect(telegramState.webhook.url).toBe(WEBHOOK) // починил снова
    expect(toOwner()).toHaveLength(1) // но тревога — не чаще раза в 30 минут
  })

  it('чужой адрес — ставит свой и советует перевыпустить токен', async () => {
    resetWebhook({ url: 'https://evil.example/hook' })
    await watchWebhook(E)
    expect(telegramState.webhook.url).toBe(WEBHOOK)
    expect(toOwner()[0]).toMatch(/ЧУЖОЙ адрес evil\.example.*перевыпусти/s)
  })

  it('свежая ошибка доставки или очередь > 20 — тревога', async () => {
    const now = Date.now()
    resetWebhook({ last_error_date: Math.floor(now / 1000) - 60, last_error_message: 'Wrong response from the webhook: 500 Internal Server Error', pending_update_count: 25 })
    await watchWebhook(E, now)
    expect(sent('setWebhook')).toHaveLength(0)
    expect(toOwner()[0]).toContain('500 Internal Server Error')
    expect(toOwner()[0]).toContain('В очереди Telegram 25')
  })

  it('старая ошибка доставки (час назад) — не тревога', async () => {
    const now = Date.now()
    resetWebhook({ last_error_date: Math.floor(now / 1000) - 3600, last_error_message: 'old' })
    expect(await watchWebhook(E, now)).toBe(1)
  })

  it('после деплоя — проверка сразу; откат на старую версию — сообщение владельцу', async () => {
    const at = (id: string, timestamp: string) => ({ ...E, CF_VERSION_METADATA: { id, tag: '', timestamp } }) as unknown as Env
    await afterDeploy(at('v-new', '2026-10-23T18:00:00Z'))
    expect(sent('getWebhookInfo').length).toBeGreaterThan(0)
    expect(toOwner()).toHaveLength(0) // обычный деплой, вебхук в порядке — тишина
    await afterDeploy(at('v-old', '2026-10-23T12:00:00Z'))
    expect(toOwner()[0]).toMatch(/откатился на версию v-old/)
  })
})

describe('ошибки владельцу — не чаще раза в час', () => {
  it('одинаковая ошибка (и с другими числами) — один раз; другая — отдельно', async () => {
    await reportError(E, 'Тест', new Error('Telegram setWebhook: Bad Request 400 at 18:58'))
    await reportError(E, 'Тест', new Error('Telegram setWebhook: Bad Request 400 at 19:25'))
    await reportError(E, 'Тест', new Error('Совсем другая ошибка'))
    expect(toOwner()).toHaveLength(2)
  })
})
