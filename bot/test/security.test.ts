// Автотесты безопасности воркера (npm test в bot/, в CI — .github/workflows/tests.yml).
// Отказ в доступе у API — 403 (приложение так и обрабатывает); 413 — тело велико; 429 — слишком часто.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  MINE_TEACHER, OTHER_TEACHER, OWNER, call, eventually, initData, mockOutbound, newUser, post, postAs, sendUpdate, sql,
  telegramCalls,
} from './helpers'

beforeAll(() => mockOutbound())

const PRIVATE = [
  '/seen', '/profile', '/support', '/intro', '/my-subgroups', '/extras', '/starosta/info', '/cal/status', '/board/enter',
  '/reviews/top', '/admin/dashboard',
]
const ADMIN_ACTIONS = [
  'dashboard', 'users', 'user', 'ban', 'unban', 'board-ban', 'review-ban', 'reset-intro', 'places', 'academic',
  'academic-save', 'academic-reset', 'place-save', 'place-reset', 'access', 'starosta', 'export', 'broadcast-info',
  'broadcast-count', 'broadcast', 'reports', 'moderate', 'reviews', 'review-moderate', 'feed', 'schedule', 'update-now',
  'edit-add', 'edit-delete', 'settings', 'settings-save', 'greeting-preview', 'nonexistent',
]
const PAYLOADS = [
  `'); DROP TABLE users; --`,
  `" OR 1=1 -- комментарий`,
  `<script>alert(document.cookie)</script>`,
  `<img src=x onerror=alert(1)> & <b>жирный</b>`,
]

describe('подпись initData', () => {
  it.each(PRIVATE)('%s: без initData — 403', async (path) => {
    expect((await post(path, {})).status).toBe(403)
  })
  it.each(PRIVATE)('%s: поддельная подпись — 403', async (path) => {
    expect((await post(path, { initData: await initData(newUser(), { tamper: true }) })).status).toBe(403)
  })
  it.each(PRIVATE)('%s: просроченный (2 суток) — 403', async (path) => {
    const old = Math.floor(Date.now() / 1000) - 2 * 86_400
    expect((await post(path, { initData: await initData(newUser(), { authDate: old }) })).status).toBe(403)
  })
  it('auth_date из будущего — 403', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400
    expect((await post('/profile', { initData: await initData(newUser(), { authDate: future }) })).status).toBe(403)
  })
  it('id пользователя берётся только из initData, не из тела', async () => {
    const me = newUser()
    const victim = newUser()
    await postAs(victim, '/seen', { v: 2 })
    const res = await postAs(me, '/profile', { role: 'student', group: 'b1-mb-mp-2', id: victim, user_id: victim })
    expect(res.status).toBe(200)
    const row = await sql('SELECT grp FROM users WHERE id = ?', victim).first<{ grp: string | null }>()
    expect(row?.grp ?? null).not.toBe('b1-mb-mp-2')
  })
})

describe('админка — только владелец', () => {
  it.each(ADMIN_ACTIONS)('/admin/%s: чужому — 403', async (action) => {
    expect((await postAs(newUser(), `/admin/${action}`, { id: OWNER })).status).toBe(403)
  })
  it('владельцу дашборд открывается', async () => {
    expect((await postAs(OWNER, '/admin/dashboard')).status).toBe(200)
  })
  it('админская команда у обычного пользователя — тишина', async () => {
    const id = newUser()
    const before = telegramCalls.length
    await sendUpdate({ update_id: 900_001, message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'X' }, text: '/stats' } })
    await new Promise((r) => setTimeout(r, 300))
    const sent = telegramCalls.slice(before).filter((c) => c.method === 'sendMessage' && (c.body as { chat_id: number }).chat_id === id)
    expect(sent).toHaveLength(0)
  })
})

describe('старосты — только своя группа', () => {
  it('не староста — 403', async () => {
    expect((await postAs(newUser(), '/starosta/info')).status).toBe(403)
  })
  it('подмена группы в запросе не помогает (IDOR)', async () => {
    const s = newUser()
    await postAs(s, '/seen', { v: 2 })
    await sql('UPDATE users SET starosta_of = ? WHERE id = ?', 'b1-mb-mp-1', s).run()
    const res = await postAs(s, '/starosta/edit-add', {
      kind: 'note', date: '2026-10-22', start: null, text: 'проверка', groups: ['b1-mb-mp-2'], grp: 'b1-mb-mp-2', group: 'b1-mb-mp-2',
    })
    expect(res.status).toBe(200)
    const rows = await sql('SELECT grp FROM schedule_edits WHERE author_id = ?', s).all<{ grp: string }>()
    expect(rows.results.map((r) => r.grp)).toEqual(['b1-mb-mp-1'])
  })
  it('чужую правку (другой группы) убрать нельзя', async () => {
    const other = await sql(
      `INSERT INTO schedule_edits (grp, date, start, kind, text, created_at, author_id) VALUES ('b1-mb-mp-2', '2026-10-23', NULL, 'note', 'чужая', 1, 123) RETURNING id`,
    ).first<{ id: number }>()
    const s = newUser()
    await postAs(s, '/seen', { v: 2 })
    await sql('UPDATE users SET starosta_of = ? WHERE id = ?', 'b1-mb-mp-1', s).run()
    const res = await postAs(s, '/starosta/edit-delete', { id: other!.id })
    expect(res.status).toBe(404)
    const row = await sql('SELECT reverted_at FROM schedule_edits WHERE id = ?', other!.id).first<{ reverted_at: number | null }>()
    expect(row?.reverted_at).toBeNull()
  })
})

describe('отзывы — только своему преподавателю', () => {
  const review = { clarity: 4, competence: 5, communication: 4, recommend: true, text: 'Понятно объясняет и разбирает задачи.', confirm: true }
  it('чужому преподавателю — отказ', async () => {
    const u = newUser()
    await postAs(u, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    const res = await postAs(u, '/reviews/save', { teacher: OTHER_TEACHER, ...review })
    expect(res.status).toBe(403)
  })
  it('своему — можно (контроль)', async () => {
    const u = newUser()
    await postAs(u, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    expect((await postAs(u, '/reviews/save', { teacher: MINE_TEACHER, ...review })).status).toBe(200)
  })
})

describe('SQL- и XSS-нагрузки сохраняются как текст', () => {
  it.each(PAYLOADS)('Подслушано: %s', async (payload) => {
    const u = newUser()
    await postAs(u, '/board/accept')
    const sent = await postAs(u, '/board/send', { board: 'all', text: payload })
    expect(sent.status).toBe(200)
    const poll = (await (await postAs(newUser(), '/board/poll', { board: 'all', mode: 'chat', since: 0 })).json()) as { messages?: { text: string }[] }
    // читатель без принятых правил получает 403 — читаем через автора
    const mine = (await (await postAs(u, '/board/poll', { board: 'all', mode: 'chat', since: 0 })).json()) as { messages: { text: string }[] }
    expect(mine.messages.some((m) => m.text === payload)).toBe(true)
    expect(poll).toBeTruthy()
    expect((await sql('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBeGreaterThan(0)
  })
  it.each(PAYLOADS)('отзыв: %s', async (payload) => {
    const u = newUser()
    await postAs(u, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    const text = `${payload} — разбираем задачи на семинаре`
    const res = await postAs(u, '/reviews/save', { teacher: MINE_TEACHER, clarity: 3, competence: 3, communication: 3, recommend: false, text, confirm: true })
    expect(res.status).toBe(200)
    const row = await sql('SELECT text FROM teacher_reviews WHERE user_id = ?', u).first<{ text: string }>()
    expect(row?.text).toBe(text)
  })
  it.each(PAYLOADS)('обращение в поддержку → владельцу экранированным HTML: %s', async (payload) => {
    const before = telegramCalls.length
    expect((await postAs(newUser(), '/support', { text: payload })).status).toBe(200)
    const msg = telegramCalls.slice(before).find((c) => c.method === 'sendMessage')!.body as { text: string; parse_mode: string }
    expect(msg.parse_mode).toBe('HTML')
    expect(msg.text).not.toContain('<script')
    expect(msg.text).not.toContain('<img')
  })
  it('название места (админка) с нагрузкой сохраняется как текст', async () => {
    const res = await postAs(OWNER, '/admin/place-save', { place: { name: PAYLOADS[0], lat: 55.71, lon: 37.81 } })
    expect(res.status).toBe(200)
    const row = await sql(`SELECT data FROM place_edits ORDER BY updated_at DESC LIMIT 1`).first<{ data: string }>()
    expect(JSON.parse(row!.data).name).toBe(PAYLOADS[0])
  })
})

describe('размер тела', () => {
  const big = 'x'.repeat(70 * 1024)
  it.each(['/seen', '/support', '/board/send', '/profile'])('%s: 70 КБ — 413', async (path) => {
    expect((await post(path, { initData: await initData(newUser()), text: big })).status).toBe(413)
  })
  it('вебхук: 2 МБ — 413', async () => {
    expect((await sendUpdate({ update_id: 1, pad: 'y'.repeat(2 * 1024 * 1024) })).status).toBe(413)
  })
  it('админка: 13 МБ — 413', async () => {
    expect((await post('/admin/broadcast', { initData: await initData(OWNER), photo: 'z'.repeat(13 * 1024 * 1024) })).status).toBe(413)
  })
})

describe('лимиты запросов', () => {
  it('частые открытия одним человеком — 429', async () => {
    const u = newUser()
    const codes = []
    for (let i = 0; i < 20; i++) codes.push((await postAs(u, '/seen', { v: 2 })).status)
    expect(codes).toContain(429)
    expect(codes.filter((c) => c === 200).length).toBeGreaterThan(5)
  })
  it('частые записи — 429 до базы', async () => {
    const u = newUser()
    await postAs(u, '/board/accept')
    const codes = []
    for (let i = 0; i < 40; i++) codes.push((await postAs(u, '/board/react', { id: 1, emoji: '👍' })).status)
    expect(codes).toContain(429)
  })
})

describe('анонимность «Подслушано»', () => {
  it('обычный читатель не видит id, имени и ника автора; владелец видит', async () => {
    const author = newUser()
    await post('/board/accept', { initData: await initData(author, { name: 'Секретное Имя' }) })
    await post('/board/send', { initData: await initData(author, { name: 'Секретное Имя' }), board: 'all', text: 'анонимное сообщение' })
    const reader = newUser()
    await postAs(reader, '/board/accept')
    const raw = await (await postAs(reader, '/board/poll', { board: 'all', mode: 'chat', since: 0 })).text()
    expect(raw).toContain('анонимное сообщение')
    expect(raw).not.toContain('Секретное')
    expect(raw).not.toContain(String(author))
    expect(raw).not.toContain(`u${author}`)
    expect(raw).not.toContain('"author"')
    expect(raw).not.toContain('user_id')
    await postAs(OWNER, '/board/accept')
    const admin = await (await postAs(OWNER, '/board/poll', { board: 'all', mode: 'chat', since: 0 })).text()
    expect(admin).toContain(String(author))
  })
})

describe('вебхук Telegram', () => {
  it('чужой секрет — 403', async () => {
    expect((await sendUpdate({ update_id: 1 }, 'wrong')).status).toBe(403)
  })
  it('GET — 404', async () => {
    expect((await call('/webhook')).status).toBe(404)
  })
  it('повтор того же update_id обрабатывается один раз', async () => {
    const id = newUser()
    const update = { update_id: 777_001, message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'П' }, text: '/start' } }
    await sendUpdate(update)
    await sendUpdate(update)
    const row = await eventually(() => sql('SELECT starts FROM users WHERE id = ?', id).first<{ starts: number }>())
    await new Promise((r) => setTimeout(r, 300))
    expect((await sql('SELECT starts FROM users WHERE id = ?', id).first<{ starts: number }>())!.starts).toBe(row.starts)
    expect(row.starts).toBe(1)
  })
})

describe('CORS', () => {
  it('чужой сайт не получает Access-Control-Allow-Origin', async () => {
    const res = await call('/places', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
  it('приложение получает свой origin', async () => {
    const res = await call('/places', { headers: { Origin: 'https://site.test' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://site.test')
  })
})

describe('/deleteme', () => {
  it('удаляет профиль и обезличивает сообщения; чужой кнопкой — нельзя', async () => {
    const u = newUser()
    await postAs(u, '/board/accept')
    await postAs(u, '/board/send', { board: 'all', text: 'до удаления' })
    const victim = newUser()
    await postAs(victim, '/seen', { v: 2 })
    // кнопка «Да, удалить» в чужом чате — не срабатывает
    await sendUpdate({ update_id: 778_001, callback_query: { id: 'x', from: { id: u, first_name: 'У' }, data: 'dm:yes', message: { message_id: 1, chat: { id: victim, type: 'private' } } } })
    await sendUpdate({ update_id: 778_002, callback_query: { id: 'y', from: { id: u, first_name: 'У' }, data: 'dm:yes', message: { message_id: 1, chat: { id: u, type: 'private' } } } })
    await eventually(async () => !(await sql('SELECT id FROM users WHERE id = ?', u).first()))
    expect(await sql('SELECT id FROM users WHERE id = ?', victim).first()).not.toBeNull()
    const msg = await sql(`SELECT user_id FROM board_messages WHERE text = 'до удаления'`).first<{ user_id: number }>()
    expect(msg!.user_id).toBeLessThan(0)
  })
})

describe('публичное и служебное', () => {
  it('/health — 200 без внутренних данных', async () => {
    const res = await call('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
  it('ETag: повтор — 304', async () => {
    const first = await call('/places')
    const etag = first.headers.get('ETag')!
    expect((await call('/places', { headers: { 'If-None-Match': etag } })).status).toBe(304)
  })
})
