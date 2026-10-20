// «Подслушано» — анонимный чат на весь ГУУ: API мини-приложения, POST /board/<действие>, тело — {initData, ...}.
//
//   enter / accept — вход и экран правил; poll — лента (раз в 4 с); send, react, report, delete — чат;
//   origin — подпись к псевдониму «1 курс, ИУПСиБК» (переключатель в профиле, по умолчанию выключен).
//
// Обычные пользователи видят только псевдонимы и флаг mine («моё»): ни id, ни имён.
// Админ (OWNER_ID) видит настоящих авторов, скрытые сообщения и число жалоб.
// Псевдоним: HMAC(id + доска + семестр, BOARD_SALT) → имя из списка; выданный хранится в D1.
import { json, readApi, type ApiRequest } from './api'
import { ALIASES, BOARDS, BOARD_IDS, LIMITS, REACTIONS, type BoardId } from './board-config'
import { cleanText, passesFilter } from './board-filter'
import { deleteMessage, notifyReport } from './board-moderation'
import { normalizeGroup, originLabel } from '../../shared/groups'
import { allow, tooMany } from './guard'
import { economyMode } from './usage'
import { loadGroupsIndex } from './schedule'

const DAY_MS = 86_400_000
// запас при опросе «что изменилось»: часы разных серверов Cloudflare могут чуть расходиться
const OVERLAP_MS = 15_000

type Member = {
  user_id: number
  rules_accepted_at: number | null
  day: string | null
  day_messages: number
  last_message_at: number | null
}

type Body = {
  board?: unknown
  mode?: unknown
  since?: unknown
  before?: unknown
  text?: unknown
  reply_to?: unknown
  id?: unknown
  emoji?: unknown
  on?: unknown
}

type Call = {
  env: Env
  req: ApiRequest<Body>
  member: Member | null
  now: number
}

// ---------- общее ----------

const MSK_OFFSET_MS = 3 * 3_600_000
const mskDate = (ms: number) => new Date(ms + MSK_OFFSET_MS).toISOString().slice(0, 10)

// псевдонимы меняются раз в семестр: «2026-осень», «2027-весна»
export function semesterOf(ms: number): string {
  const date = new Date(ms + MSK_OFFSET_MS)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  if (month >= 8) return `${year}-осень`
  if (month === 1) return `${year - 1}-осень`
  return `${year}-весна`
}

// все видят одни и те же доски — сейчас это одна, «Подслушано»
export const visibleBoards = (): BoardId[] => BOARD_IDS

const fail = (status: number, error: string, extra: object = {}) => json({ ok: false, error, ...extra }, status)

const asInt = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)

// бан на доске (до какого момента), если он ещё идёт
function bannedUntil(call: Call): number | null {
  if (call.req.admin) return null
  const until = call.req.user?.board_banned_until ?? null
  return until && until > call.now ? until : null
}

// ---------- псевдонимы ----------

async function hmacIndex(salt: string, data: string): Promise<number> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
  return ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0
}

async function assignAlias(env: Env, userId: number, board: BoardId, semester: string): Promise<string> {
  const start = (await hmacIndex(env.BOARD_SALT!, `${userId}:${board}:${semester}`)) % ALIASES.length
  // занятые пропускаем; два человека одновременно — второй попробует ещё раз
  for (let attempt = 0; attempt < 3; attempt++) {
    const { results } = await env.DB.prepare('SELECT alias FROM board_aliases WHERE board = ? AND semester = ?')
      .bind(board, semester)
      .all<{ alias: string }>()
    const taken = new Set(results.map((row) => row.alias))
    let alias = ALIASES.map((_, k) => ALIASES[(start + k) % ALIASES.length]).find((name) => !taken.has(name))
    if (!alias) {
      let n = 2
      while (taken.has(`${ALIASES[start]} ${n}`)) n++
      alias = `${ALIASES[start]} ${n}`
    }
    const [, mine] = await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO board_aliases (board, semester, user_id, alias) VALUES (?, ?, ?, ?)').bind(
        board,
        semester,
        userId,
        alias,
      ),
      env.DB.prepare('SELECT alias FROM board_aliases WHERE board = ? AND semester = ? AND user_id = ?').bind(
        board,
        semester,
        userId,
      ),
    ])
    const row = (mine.results as { alias: string }[])[0]
    if (row) return row.alias
  }
  throw new Error(`Не удалось выдать псевдоним: доска ${board}, пользователь ${userId}`)
}

async function aliasesFor(env: Env, userId: number, boards: BoardId[], now: number): Promise<Record<string, string>> {
  const semester = semesterOf(now)
  const { results } = await env.DB.prepare('SELECT board, alias FROM board_aliases WHERE user_id = ? AND semester = ?')
    .bind(userId, semester)
    .all<{ board: string; alias: string }>()
  const aliases: Record<string, string> = Object.fromEntries(results.map((row) => [row.board, row.alias]))
  for (const board of boards) aliases[board] ??= await assignAlias(env, userId, board, semester)
  return aliases
}

// ---------- сообщения ----------

type MessageRow = {
  id: number
  board: string
  user_id: number
  alias: string
  origin: string | null
  text: string
  reply_to: number | null
  created_at: number
  deleted: number
  hidden: number
  reply_alias: string | null
  reply_text: string | null
  author_name: string | null
  author_username: string | null
}

type Reaction = { emoji: string; count: number; me: boolean }

const selectMessages = (admin: boolean) => `
  SELECT m.id, m.board, m.user_id, m.alias, m.origin, m.text, m.reply_to, m.created_at, m.deleted, m.hidden,
         r.alias AS reply_alias,
         CASE WHEN r.deleted = 0 AND r.hidden = 0 THEN substr(r.text, 1, 120) END AS reply_text,
         ${admin ? 'u.name' : 'NULL'} AS author_name, ${admin ? 'u.username' : 'NULL'} AS author_username
  FROM board_messages m
  LEFT JOIN board_messages r ON r.id = m.reply_to
  ${admin ? 'LEFT JOIN users u ON u.id = m.user_id' : ''}`

const shown = (row: MessageRow, admin: boolean) => !row.deleted && (admin || !row.hidden)

// реакции (и для админа — открытые жалобы) к сообщениям — одним запросом к D1
async function outMessages(env: Env, rows: MessageRow[], viewerId: number, admin: boolean) {
  const ids = JSON.stringify(rows.filter((row) => shown(row, admin)).map((row) => row.id))
  const reactions = new Map<number, Reaction[]>()
  const reports = new Map<number, number>()
  if (ids !== '[]') {
    const statements = [
      env.DB.prepare(
        `SELECT message_id, emoji, COUNT(*) AS n, MAX(user_id = ?2) AS me FROM board_reactions
         WHERE message_id IN (SELECT value FROM json_each(?1)) GROUP BY message_id, emoji`,
      ).bind(ids, viewerId),
    ]
    if (admin) {
      statements.push(
        env.DB.prepare(
          `SELECT message_id, COUNT(*) AS n FROM board_reports
           WHERE status = 'open' AND message_id IN (SELECT value FROM json_each(?1)) GROUP BY message_id`,
        ).bind(ids),
      )
    }
    const [reactionRows, reportRows] = await env.DB.batch(statements)
    for (const r of reactionRows.results as { message_id: number; emoji: string; n: number; me: number }[]) {
      const list = reactions.get(r.message_id) ?? []
      list.push({ emoji: r.emoji, count: r.n, me: Boolean(r.me) })
      reactions.set(r.message_id, list)
    }
    for (const r of (reportRows?.results ?? []) as { message_id: number; n: number }[]) reports.set(r.message_id, r.n)
  }
  return rows.map((row) => messageOut(row, viewerId, admin, reactions.get(row.id) ?? [], reports.get(row.id) ?? 0))
}

function messageOut(row: MessageRow, viewerId: number, admin: boolean, reactions: Reaction[], reports: number) {
  if (!shown(row, admin)) return { id: row.id, removed: true }
  return {
    id: row.id,
    alias: row.alias,
    origin: row.origin, // «1 курс, ИУПСиБК» — если автор включил подпись
    text: row.text,
    at: row.created_at,
    reply_to: row.reply_to,
    // ответ на удалённое сообщение: alias есть, текста нет
    reply: row.reply_to ? { alias: row.reply_alias, text: row.reply_text } : null,
    reactions: reactions.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji)),
    mine: row.user_id === viewerId,
    ...(admin
      ? {
          author: { id: row.user_id, name: row.author_name, username: row.author_username },
          hidden: Boolean(row.hidden),
          reports,
        }
      : {}),
  }
}

// ---------- действия ----------

// Подпись «курс, институт» — по группе студента (у преподавателя и без группы — нет)
async function originOf(env: Env, user: ApiRequest<Body>['user']): Promise<string | null> {
  const group = user?.role === 'teacher' ? null : normalizeGroup(user?.grp)
  if (!group) return null
  const info = (await loadGroupsIndex(env)).groups.find((g) => g.id === group)
  return info ? originLabel(info) : null
}

async function enterPayload(call: Call) {
  const { env, req, now } = call
  const board = BOARD_IDS[0]
  const alias = (await aliasesFor(env, req.profile.id, [board], now))[board]
  return {
    ok: true,
    rules: true,
    admin: req.admin,
    board,
    alias,
    // для версий приложения, закэшированных в Telegram (у них переключатель досок)
    boards: [{ id: board, title: BOARDS[board].title, alias }],
    banned_until: bannedUntil(call),
    config: {
      reactions: REACTIONS,
      message_length: LIMITS.messageLength,
      keep_days: LIMITS.keepMessagesDays,
    },
  }
}

async function enter(call: Call): Promise<Response> {
  if (!call.member?.rules_accepted_at) return json({ ok: true, rules: false })
  return json(await enterPayload(call))
}

async function accept(call: Call): Promise<Response> {
  const { env, req, now } = call
  call.member = await env.DB.prepare(
    `INSERT INTO board_members (user_id, rules_accepted_at) VALUES (?1, ?2)
     ON CONFLICT (user_id) DO UPDATE SET rules_accepted_at = COALESCE(board_members.rules_accepted_at, ?2)
     RETURNING *`,
  )
    .bind(req.profile.id, now)
    .first<Member>()
  return json(await enterPayload(call))
}

async function poll(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const since = asInt(req.body.since) ?? 0
  // старая версия приложения с рисовалкой — пустой холст
  if (req.body.mode === 'draw') return json({ ok: true, cursor: now, strokes: [], banned_until: bannedUntil(call) })

  const before = asInt(req.body.before)
  const select = selectMessages(req.admin)
  const hiddenFilter = req.admin ? '' : 'AND m.hidden = 0'
  let rows: MessageRow[]
  let hasMore = false
  if (since > 0 && before === null) {
    // что изменилось: новые, удалённые, скрытые, реакции, подписи
    rows = (
      await env.DB.prepare(`${select} WHERE m.board = ?1 AND m.updated_at > ?2 ORDER BY m.id LIMIT 500`)
        .bind(board, since - OVERLAP_MS)
        .all<MessageRow>()
    ).results
  } else {
    // последние (или более ранние, чем before) — страница ленты
    const cutoff = now - LIMITS.keepMessagesDays * DAY_MS
    rows = (
      await env.DB.prepare(
        `${select} WHERE m.board = ?1 AND m.deleted = 0 ${hiddenFilter} AND m.created_at > ?2 AND m.id < ?3
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?4`,
      )
        .bind(board, cutoff, before ?? Number.MAX_SAFE_INTEGER, LIMITS.pageSize)
        .all<MessageRow>()
    ).results.reverse()
    hasMore = rows.length === LIMITS.pageSize
  }
  return json({
    ok: true,
    cursor: now,
    messages: await outMessages(env, rows, req.profile.id, req.admin),
    has_more: hasMore,
    banned_until: bannedUntil(call),
  })
}

async function send(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const member = call.member!
  const text = cleanText(req.body.text)
  if (!text) return fail(400, 'empty')
  if ([...text].length > LIMITS.messageLength) return fail(400, 'too-long')
  if (!passesFilter(text)) return fail(400, 'filter')

  const today = mskDate(now)
  if (!req.admin) {
    const wait = member.last_message_at ? LIMITS.messageInterval - (now - member.last_message_at) : 0
    if (wait > 0) return fail(429, 'slow', { wait })
    if (member.day === today && member.day_messages >= LIMITS.messagesPerDay) return fail(429, 'day-limit')
  }

  // ответ — только на живое сообщение той же доски
  let reply: { id: number; alias: string; text: string } | null = null
  const replyTo = asInt(req.body.reply_to)
  if (replyTo !== null) {
    reply = await env.DB.prepare(
      'SELECT id, alias, text FROM board_messages WHERE id = ? AND board = ? AND deleted = 0 AND hidden = 0',
    )
      .bind(replyTo, board)
      .first()
  }

  const alias = (await aliasesFor(env, req.profile.id, [board], now))[board]
  // подпись «курс, институт» — только если включена; группы не нашлось — без подписи
  const origin = req.user?.board_origin ? await originOf(env, req.user).catch(() => null) : null
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO board_messages (board, user_id, alias, origin, text, reply_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(board, req.profile.id, alias, origin, text, reply?.id ?? null, now, now),
    env.DB.prepare(
      `UPDATE board_members SET
         day = ?2,
         day_messages = CASE WHEN day = ?2 THEN day_messages + 1 ELSE 1 END,
         last_message_at = ?3
       WHERE user_id = ?1`,
    ).bind(req.profile.id, today, now),
  ])
  const id = (inserted.results as { id: number }[])[0].id
  const row: MessageRow = {
    id,
    board,
    user_id: req.profile.id,
    alias,
    origin,
    text,
    reply_to: reply?.id ?? null,
    created_at: now,
    deleted: 0,
    hidden: 0,
    reply_alias: reply?.alias ?? null,
    reply_text: reply ? [...reply.text].slice(0, 120).join('') : null,
    author_name: req.profile.name,
    author_username: req.profile.username,
  }
  return json({ ok: true, message: messageOut(row, req.profile.id, req.admin, [], 0) })
}

type TargetMessage = { id: number; board: string; user_id: number; alias: string; text: string; deleted: number; hidden: number }

// сообщение, которое этот человек вправе видеть (иначе null)
async function visibleMessage(call: Call): Promise<TargetMessage | null> {
  const id = asInt(call.req.body.id)
  if (id === null) return null
  const row = await call.env.DB.prepare(
    'SELECT id, board, user_id, alias, text, deleted, hidden FROM board_messages WHERE id = ?',
  )
    .bind(id)
    .first<TargetMessage>()
  const boards = visibleBoards() as string[]
  if (!row || row.deleted || (row.hidden && !call.req.admin) || !boards.includes(row.board)) return null
  return row
}

async function react(call: Call): Promise<Response> {
  const { env, req, now } = call
  const emoji = req.body.emoji
  if (typeof emoji !== 'string' || !REACTIONS.includes(emoji)) return fail(400, 'bad request')
  const message = await visibleMessage(call)
  if (!message) return fail(404, 'gone')
  const on = req.body.on !== false
  const results = await env.DB.batch([
    on
      ? env.DB.prepare('INSERT OR IGNORE INTO board_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').bind(
          message.id,
          req.profile.id,
          emoji,
        )
      : env.DB.prepare('DELETE FROM board_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').bind(
          message.id,
          req.profile.id,
          emoji,
        ),
    env.DB.prepare('UPDATE board_messages SET updated_at = ? WHERE id = ?').bind(now, message.id),
    env.DB.prepare(
      'SELECT emoji, COUNT(*) AS count, MAX(user_id = ?2) AS me FROM board_reactions WHERE message_id = ?1 GROUP BY emoji',
    ).bind(message.id, req.profile.id),
  ])
  const reactions = (results[2].results as { emoji: string; count: number; me: number }[])
    .map((r) => ({ emoji: r.emoji, count: r.count, me: Boolean(r.me) }))
    .sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji))
  return json({ ok: true, id: message.id, reactions })
}

async function report(call: Call): Promise<Response> {
  const { env, req, now } = call
  const message = await visibleMessage(call)
  if (!message) return fail(404, 'gone')
  if (message.user_id === req.profile.id) return fail(400, 'own')
  const [inserted, counted] = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO board_reports (message_id, reporter_id, created_at) VALUES (?, ?, ?)').bind(
      message.id,
      req.profile.id,
      now,
    ),
    env.DB.prepare("SELECT COUNT(*) AS n FROM board_reports WHERE message_id = ? AND status = 'open'").bind(message.id),
  ])
  if (inserted.meta.changes) {
    const count = (counted.results as { n: number }[])[0].n
    if (count >= LIMITS.reportsToHide && !message.hidden) {
      await env.DB.prepare('UPDATE board_messages SET hidden = 1, updated_at = ? WHERE id = ?').bind(now, message.id).run()
      await notifyReport(env, message, count, true)
    } else if (count === 1) {
      await notifyReport(env, message, count, false)
    }
  }
  return json({ ok: true })
}

async function remove(call: Call): Promise<Response> {
  const message = await visibleMessage(call)
  if (!message) return fail(404, 'gone')
  await deleteMessage(call.env, message.id, call.now)
  return json({ ok: true, id: message.id })
}

// Подпись к псевдониму: включить — у новых сообщений; выключить — пропадает и у старых
async function origin(call: Call): Promise<Response> {
  const { env, req, now } = call
  const on = req.body.on === true
  const label = on ? await originOf(env, req.user) : null
  if (on && !label) return fail(400, 'no-group')
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET board_origin = ? WHERE id = ?').bind(on ? 1 : 0, req.profile.id),
    ...(on
      ? []
      : [
          env.DB.prepare('UPDATE board_messages SET origin = NULL, updated_at = ? WHERE user_id = ? AND origin IS NOT NULL').bind(
            now,
            req.profile.id,
          ),
        ]),
  ])
  return json({ ok: true, on, label })
}

// ---------- маршрутизация ----------

const ACTIONS = ['enter', 'accept', 'poll', 'send', 'react', 'report', 'delete', 'origin'] as const
type Action = (typeof ACTIONS)[number]
// с баном можно только читать
const WRITES: Action[] = ['send', 'react', 'report']
const ADMIN_ONLY: Action[] = ['delete']

export const isBoardAction = (action: string): action is Action => (ACTIONS as readonly string[]).includes(action)

export async function handleBoardApi(env: Env, request: Request, action: Action): Promise<Response> {
  const req = await readApi<Body>(env, request, { write: WRITES.includes(action) || action === 'accept' || action === 'origin' })
  if (req instanceof Response) return req
  if (!env.BOARD_SALT) return fail(503, 'not-configured')
  if (ADMIN_ONLY.includes(action) && !req.admin) return fail(403, 'forbidden')

  const member = await env.DB.prepare('SELECT * FROM board_members WHERE user_id = ?').bind(req.profile.id).first<Member>()
  const call: Call = { env, req, member, now: Date.now() }
  if (action === 'enter') return enter(call)
  if (action === 'accept') return accept(call)
  // подпись к псевдониму меняют в профиле — правила для этого принимать не нужно
  if (action === 'origin') return origin(call)
  if (!member?.rules_accepted_at) return fail(403, 'rules')

  const until = bannedUntil(call)
  if (until && WRITES.includes(action)) return fail(403, 'board-banned', { until })

  if (action === 'react') return react(call)
  if (action === 'report') return report(call)
  if (action === 'delete') return remove(call)

  const board = req.body.board as BoardId
  if (!visibleBoards().includes(board)) return fail(403, 'board')
  // режим экономии: опрос не чаще ~раза в 15 с (приложение молча повторит позже — интерфейс тот же)
  if (action === 'poll' && economyMode() && !req.admin && !(await allow(env, 'RL_SLOW', req.profile.id))) return tooMany()
  return action === 'poll' ? poll(call, board) : send(call, board)
}

// Для точки «есть новое»: время последнего сообщения на каждой доске (для POST /seen)
export async function boardLatest(env: Env) {
  const latest = (board: BoardId) =>
    `(SELECT created_at FROM board_messages WHERE board = '${board}' AND deleted = 0 AND hidden = 0
      ORDER BY created_at DESC LIMIT 1) AS "${board}"`
  const row = await env.DB.prepare(`SELECT ${visibleBoards().map(latest).join(', ')}`).first<Record<string, number | null>>()
  if (!row) return {}
  return Object.fromEntries(visibleBoards().filter((board) => row[board]).map((board) => [board, row[board] as number]))
}
