// Автообновление расписания: запасной путь к guu.ru, тревоги (3 часа без успешной проверки, неопубликованный файл
// guu.ru), рассылка «🔄 Расписание обновилось» только группам с изменениями.
import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OWNER, call, guuPages, mockOutbound, newUser, postAs, siteData, sql, telegramCalls } from './helpers'
import { guuTarget } from '../src/guu-relay'
import { guuFileNames, notifyChanges, watchUpdates } from '../src/updates'

const E = env as unknown as Env
const HOUR = 3_600_000
const toOwner = () =>
  telegramCalls
    .filter((c) => c.method === 'sendMessage' && (c.body as { chat_id: number }).chat_id === OWNER)
    .map((c) => (c.body as { text: string }).text)
const page = (...files: string[]) => files.map((f) => `<a href="/wp-content/uploads/${encodeURIComponent(f)}">${f}</a>`).join('\n')
const iso = (ms: number) => new Date(ms).toISOString()

beforeAll(() => mockOutbound())
beforeEach(async () => {
  telegramCalls.length = 0
  for (const key of ['update-stale-alert', 'guu-unpublished', 'guu-unpublished-alert', 'update-dispatch', 'changes-notified']) await E.KV.delete(key)
  for (const key of Object.keys(siteData)) delete siteData[key]
  guuPages['/student/schedule/'] = page('1-курс-бакалавриат-ОФО-143.xlsx')
  guuPages['/student/session/'] = page('Сессия-1-курс-бакалавриат-ОФО-11.xlsx')
})

describe('запасной путь к guu.ru (GET /guu)', () => {
  it('только guu.ru, только страницы расписания и файлы из uploads', () => {
    expect(guuTarget('https://guu.ru/student/schedule/')).not.toBeNull()
    expect(guuTarget('https://guu.ru/wp-content/uploads/1-%D0%BA%D1%83%D1%80%D1%81-143.xlsx')).not.toBeNull()
    for (const bad of [
      null,
      'http://guu.ru/student/schedule/',
      'https://evil.example/student/schedule/',
      'https://guu.ru.evil.example/student/schedule/',
      'https://guu.ru/wp-admin/',
      'https://guu.ru/wp-content/uploads/x.php',
      'https://guu.ru/student/schedule/?x=1',
      'https://user@guu.ru/student/schedule/',
    ]) {
      expect(guuTarget(bad)).toBeNull()
    }
  })

  it('отдаёт страницу и файл; чужой адрес — 404', async () => {
    const pageRes = await call(`/guu?url=${encodeURIComponent('https://guu.ru/student/schedule/')}`)
    expect(pageRes.status).toBe(200)
    expect(await pageRes.text()).toContain('143.xlsx')
    const file = await call(`/guu?url=${encodeURIComponent('https://guu.ru/wp-content/uploads/1-курс.xlsx')}`)
    expect(file.status).toBe(200)
    expect((await file.arrayBuffer()).byteLength).toBe(4)
    expect((await call(`/guu?url=${encodeURIComponent('https://example.com/')}`)).status).toBe(404)
    expect((await call('/guu')).status).toBe(404)
  })

  it('имена файлов — как у update.py (последняя часть адреса, раскодированная)', () => {
    expect(guuFileNames(page('1-курс-бакалавриат-ОФО-143.xlsx', 'УМБ.doc'), 'https://guu.ru/student/schedule/')).toEqual([
      '1-курс-бакалавриат-ОФО-143.xlsx',
      'УМБ.doc',
    ])
  })
})

describe('присмотр за автообновлением', () => {
  const files = ['1-курс-бакалавриат-ОФО-143.xlsx', 'Сессия-1-курс-бакалавриат-ОФО-11.xlsx']

  it('всё свежо — тишина', async () => {
    const now = Date.now()
    siteData['/data/status.json'] = { checked_at: iso(now - 20 * 60_000), files }
    await watchUpdates(E, now)
    expect(toOwner()).toHaveLength(0)
  })

  it('3 часа без успешной проверки — тревога, повтор — не раньше чем через 3 часа', async () => {
    const now = Date.now()
    siteData['/data/status.json'] = { checked_at: iso(now - 4 * HOUR), files }
    await watchUpdates(E, now)
    expect(toOwner()).toHaveLength(1)
    expect(toOwner()[0]).toMatch(/Уже 4 ч нет успешной проверки guu\.ru/)
    await watchUpdates(E, now + 10 * 60_000)
    expect(toOwner()).toHaveLength(1)
  })

  it('новый файл на guu.ru: сначала запоминаем, через 2 часа без публикации — тревога', async () => {
    const now = Date.now()
    siteData['/data/status.json'] = { checked_at: iso(now - 10 * 60_000), files: ['1-курс-бакалавриат-ОФО-142.xlsx', files[1]] }
    await watchUpdates(E, now)
    expect(toOwner()).toHaveLength(0)
    expect(await E.KV.get('guu-unpublished', 'json')).toEqual({ '1-курс-бакалавриат-ОФО-143.xlsx': now })
    await watchUpdates(E, now + 2 * HOUR + 60_000)
    expect(toOwner()).toHaveLength(1)
    expect(toOwner()[0]).toContain('1-курс-бакалавриат-ОФО-143.xlsx')
    // опубликовали — список пуст
    siteData['/data/status.json'] = { checked_at: iso(now + 2 * HOUR), files }
    await watchUpdates(E, now + 2 * HOUR + 5 * 60_000)
    expect(await E.KV.get('guu-unpublished', 'json')).toEqual({})
  })
})

describe('«🔄 Расписание обновилось»', () => {
  it('только людям групп с изменениями, один раз на публикацию', async () => {
    const changed = newUser()
    const other = newUser()
    await postAs(changed, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    await postAs(other, '/profile', { role: 'student', group: 'b1-mb-mp-2' })
    // рассылки — только тем, кто запускал бота (can_message)
    await sql('UPDATE users SET can_message = 1 WHERE id IN (?, ?)', changed, other).run()
    const now = Date.now()
    siteData['/data/changes.json'] = { id: 'pub-1', at: iso(now - 5 * 60_000), groups: ['b1-mb-mp-1'] }
    expect(await notifyChanges(E, now)).toBe(8)
    const bc = await sql('SELECT id, text, button FROM broadcasts ORDER BY id DESC LIMIT 1').first<{ id: number; text: string; button: string }>()
    expect(bc!.text).toContain('Расписание обновилось')
    expect(JSON.parse(bc!.button)).toMatchObject({ text: '📅 Открыть расписание', url: 'https://site.test/' })
    const queued = (await sql('SELECT user_id FROM broadcast_queue WHERE broadcast_id = ?', bc!.id).all<{ user_id: number }>()).results.map((r) => r.user_id)
    expect(queued).toContain(changed)
    expect(queued).not.toContain(other)
    expect(toOwner()[0]).toMatch(/обновилось у групп: <b>1<\/b>/)
    // та же публикация — второй раз не рассылаем
    expect(await notifyChanges(E, now + 10 * 60_000)).toBe(2)
  })

  it('старая публикация (больше суток) — без рассылки', async () => {
    const now = Date.now()
    siteData['/data/changes.json'] = { id: 'pub-old', at: iso(now - 30 * HOUR), groups: ['b1-mb-mp-1'] }
    expect(await notifyChanges(E, now)).toBe(4)
    expect(toOwner()).toHaveLength(0)
  })
})
