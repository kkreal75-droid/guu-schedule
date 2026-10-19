// Анонимная доска: API мини-приложения, POST /board/<действие>, тело — {initData, ...}.
//
//   enter / accept — вход и экран правил; poll — лента чата или штрихи холста (раз в 4 с);
//   send, react, report, delete — чат; stroke, undo, erase, clear — рисовалка.
//
// Обычные пользователи видят только псевдонимы и флаг mine («моё»): ни id, ни имён.
// Админ (OWNER_ID) видит настоящих авторов, скрытые сообщения и число жалоб.
// Псевдоним: HMAC(id + доска + семестр, BOARD_SALT) → имя из списка; выданный хранится в D1.
import { CORS, json, readApi, type ApiRequest } from './api'
import { ALIASES, BOARDS, BOARD_IDS, COLORS, LIMITS, REACTIONS, WIDTHS, type BoardId } from './board-config'
import { passesFilter } from './board-filter'
import { deleteMessage, notifyReport, sendSnapshot } from './board-moderation'
import { GROUPS } from './db'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
// запас при опросе «что изменилось»: часы разных серверов Cloudflare могут чуть расходиться
const OVERLAP_MS = 15_000
const CANVAS = 1000 // холст — 1000×1000 условных единиц

type Member = {
  user_id: number
  rules_accepted_at: number | null
  board_grp: string | null
  day: string | null
  day_messages: number
  day_strokes: number
  last_message_at: number | null
  minute_at: number | null
  minute_strokes: number
}

type Body = {
  group?: unknown
  board?: unknown
  mode?: unknown
  since?: unknown
  before?: unknown
  text?: unknown
  reply_to?: unknown
  id?: unknown
  ids?: unknown
  emoji?: unknown
  on?: unknown
  color?: unknown
  width?: unknown
  points?: unknown
  png?: unknown
}

type Call = {
  env: Env
  ctx: ExecutionContext
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

const validGroup = (group: unknown) => (GROUPS as readonly unknown[]).includes(group) ? (group as string) : null

const boardOfGroup = (group: string | null): BoardId | null =>
  (BOARD_IDS.find((id) => BOARDS[id].group === group) as BoardId | undefined) ?? null

// групповые доски видят только свои; админ — все
export function visibleBoards(admin: boolean, group: string | null): BoardId[] {
  if (admin) return BOARD_IDS
  const own = boardOfGroup(group)
  return own ? [own, 'all'] : ['all']
}

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
  SELECT m.id, m.board, m.user_id, m.alias, m.text, m.reply_to, m.created_at, m.deleted, m.hidden,
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

// убираем невидимые и управляющие символы, лишние пустые строки (эмодзи с ZWJ не трогаем)
const cleanText = (text: unknown) =>
  typeof text === 'string'
    ? text
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f​‎‏‪-‮⁦-⁩﻿]/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : ''

// ---------- действия ----------

async function enterPayload(call: Call) {
  const { env, req, member, now } = call
  const boards = visibleBoards(req.admin, member!.board_grp)
  const aliases = await aliasesFor(env, req.profile.id, boards, now)
  return {
    ok: true,
    rules: true,
    admin: req.admin,
    group: member!.board_grp,
    boards: boards.map((id) => ({ id, title: BOARDS[id].title, alias: aliases[id] })),
    banned_until: bannedUntil(call),
    config: {
      colors: COLORS,
      widths: WIDTHS,
      reactions: REACTIONS,
      message_length: LIMITS.messageLength,
      points_per_stroke: LIMITS.pointsPerStroke,
      keep_days: LIMITS.keepMessagesDays,
    },
  }
}

async function enter(call: Call): Promise<Response> {
  const { member, req } = call
  if (!member?.rules_accepted_at) {
    // группа доски закрепится при «Понятно» — показываем, какая
    const group = member?.board_grp ?? validGroup(req.body.group) ?? req.user?.grp ?? GROUPS[0]
    return json({ ok: true, rules: false, group })
  }
  return json(await enterPayload(call))
}

async function accept(call: Call): Promise<Response> {
  const { env, req, now } = call
  const group = call.member?.board_grp ?? validGroup(req.body.group) ?? req.user?.grp ?? GROUPS[0]
  call.member = await env.DB.prepare(
    `INSERT INTO board_members (user_id, rules_accepted_at, board_grp) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET
       rules_accepted_at = COALESCE(board_members.rules_accepted_at, ?2),
       board_grp = COALESCE(board_members.board_grp, ?3)
     RETURNING *`,
  )
    .bind(req.profile.id, now, group)
    .first<Member>()
  return json(await enterPayload(call))
}

async function poll(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const since = asInt(req.body.since) ?? 0
  if (req.body.mode === 'draw') return pollStrokes(call, board, since)

  const before = asInt(req.body.before)
  const select = selectMessages(req.admin)
  const hiddenFilter = req.admin ? '' : 'AND m.hidden = 0'
  let rows: MessageRow[]
  let hasMore = false
  if (since > 0 && before === null) {
    // что изменилось: новые, удалённые, скрытые, реакции
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

type StrokeRow = { id: number; user_id: number; color: string; width: number; points: string; deleted: number }

// Штрихов может быть больше тысячи: собираем JSON строкой, не разбирая points (они проверены при записи)
async function pollStrokes(call: Call, board: BoardId, since: number): Promise<Response> {
  const { env, req, now } = call
  const { results } =
    since > 0
      ? await env.DB.prepare(
          'SELECT id, user_id, color, width, points, deleted FROM board_strokes WHERE board = ? AND updated_at > ? ORDER BY id',
        )
          .bind(board, since - OVERLAP_MS)
          .all<StrokeRow>()
      : await env.DB.prepare(
          'SELECT id, user_id, color, width, points, deleted FROM board_strokes WHERE board = ? AND deleted = 0 ORDER BY id',
        )
          .bind(board)
          .all<StrokeRow>()
  const me = req.profile.id
  const items = results.map((s) =>
    s.deleted
      ? `{"id":${s.id},"removed":true}`
      : `{"id":${s.id},"c":${JSON.stringify(s.color)},"w":${s.width},"p":${s.points},"mine":${s.user_id === me}${req.admin ? `,"by":${s.user_id}` : ''}}`,
  )
  const until = bannedUntil(call)
  return new Response(`{"ok":true,"cursor":${now},"strokes":[${items.join(',')}],"banned_until":${until ?? 'null'}}`, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
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
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO board_messages (board, user_id, alias, text, reply_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(board, req.profile.id, alias, text, reply?.id ?? null, now, now),
    env.DB.prepare(
      `UPDATE board_members SET
         day = ?2,
         day_messages = CASE WHEN day = ?2 THEN day_messages + 1 ELSE 1 END,
         day_strokes = CASE WHEN day = ?2 THEN day_strokes ELSE 0 END,
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
  const boards = visibleBoards(call.req.admin, call.member!.board_grp) as string[]
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

// ---------- рисовалка ----------

function validPoints(points: unknown): points is number[] {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length % 2 === 0 &&
    points.length <= LIMITS.pointsPerStroke * 2 &&
    points.every((v) => Number.isInteger(v) && v >= 0 && v <= CANVAS)
  )
}

async function stroke(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const member = call.member!
  const { color, width, points } = req.body
  if (typeof color !== 'string' || !COLORS.includes(color)) return fail(400, 'bad request')
  if (typeof width !== 'number' || !WIDTHS.includes(width)) return fail(400, 'bad request')
  if (!validPoints(points)) return fail(400, 'bad request')

  const today = mskDate(now)
  if (!req.admin) {
    const sameMinute = member.minute_at !== null && now - member.minute_at < MINUTE_MS
    if (sameMinute && member.minute_strokes >= LIMITS.strokesPerMinute) return fail(429, 'slow')
    if (member.day === today && member.day_strokes >= LIMITS.strokesPerDay) return fail(429, 'day-limit')
  }
  const json_points = JSON.stringify(points)
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO board_strokes (board, user_id, color, width, points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(board, req.profile.id, color, width, json_points, now, now),
    env.DB.prepare(
      `UPDATE board_members SET
         day = ?2,
         day_strokes = CASE WHEN day = ?2 THEN day_strokes + 1 ELSE 1 END,
         day_messages = CASE WHEN day = ?2 THEN day_messages ELSE 0 END,
         minute_strokes = CASE WHEN minute_at IS NOT NULL AND ?3 - minute_at < ?4 THEN minute_strokes + 1 ELSE 1 END,
         minute_at = CASE WHEN minute_at IS NOT NULL AND ?3 - minute_at < ?4 THEN minute_at ELSE ?3 END
       WHERE user_id = ?1`,
    ).bind(req.profile.id, today, now, MINUTE_MS),
  ])
  const id = (inserted.results as { id: number }[])[0].id
  return json({ ok: true, stroke: { id, c: color, w: width, p: points, mine: true } })
}

// отменить свой последний штрих на этой доске
async function undo(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const row = await env.DB.prepare(
    `UPDATE board_strokes SET deleted = 1, updated_at = ?3
     WHERE id = (SELECT id FROM board_strokes WHERE user_id = ?1 AND board = ?2 AND deleted = 0 ORDER BY id DESC LIMIT 1)
     RETURNING id`,
  )
    .bind(req.profile.id, board, now)
    .first<{ id: number }>()
  return json({ ok: true, id: row?.id ?? null })
}

// ластик: свои штрихи (админ — любые)
async function erase(call: Call, board: BoardId): Promise<Response> {
  const { env, req, now } = call
  const ids = req.body.ids
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => Number.isSafeInteger(id))) {
    return fail(400, 'bad request')
  }
  const { results } = await env.DB.prepare(
    `UPDATE board_strokes SET deleted = 1, updated_at = ?3
     WHERE board = ?2 AND deleted = 0 AND id IN (SELECT value FROM json_each(?4)) AND (?5 = 1 OR user_id = ?1)
     RETURNING id`,
  )
    .bind(req.profile.id, board, now, JSON.stringify(ids), req.admin ? 1 : 0)
    .all<{ id: number }>()
  return json({ ok: true, ids: results.map((row) => row.id) })
}

// очистка холста админом: сначала PNG-снимок в архив (KV), потом штрихи помечаются удалёнными
async function clear(call: Call, board: BoardId): Promise<Response> {
  const { env, ctx, req, now } = call
  const png = typeof req.body.png === 'string' ? req.body.png.replace(/^data:image\/png;base64,/, '') : ''
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0))
  } catch {
    return fail(400, 'bad png')
  }
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length > LIMITS.snapshotBytes || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return fail(400, 'bad png')

  const counted = await env.DB.prepare('SELECT COUNT(*) AS n FROM board_strokes WHERE board = ? AND deleted = 0')
    .bind(board)
    .first<{ n: number }>()
  const strokes = counted?.n ?? 0
  const snapshot = await env.DB.prepare(
    'INSERT INTO board_snapshots (board, created_at, strokes, bytes) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(board, now, strokes, bytes.length)
    .first<{ id: number }>()
  const snapshotId = snapshot!.id
  try {
    await env.KV.put(`board-snapshot:${snapshotId}`, bytes, { metadata: { board, created_at: now, strokes } })
  } catch (err) {
    // без снимка не очищаем
    await env.DB.prepare('DELETE FROM board_snapshots WHERE id = ?').bind(snapshotId).run()
    throw err
  }
  await env.DB.prepare('UPDATE board_strokes SET deleted = 1, updated_at = ? WHERE board = ? AND deleted = 0')
    .bind(now, board)
    .run()
  ctx.waitUntil(sendSnapshot(env, board, snapshotId, strokes, bytes))
  return json({ ok: true, snapshot: snapshotId, strokes })
}

// ---------- маршрутизация ----------

const ACTIONS = ['enter', 'accept', 'poll', 'send', 'react', 'report', 'delete', 'stroke', 'undo', 'erase', 'clear'] as const
type Action = (typeof ACTIONS)[number]
// с баном на доске можно только читать
const WRITES: Action[] = ['send', 'react', 'report', 'stroke', 'undo', 'erase']
const ADMIN_ONLY: Action[] = ['delete', 'clear']
// для этих нужна доска в теле запроса
const WITH_BOARD: Action[] = ['poll', 'send', 'stroke', 'undo', 'erase', 'clear']

export const isBoardAction = (action: string): action is Action => (ACTIONS as readonly string[]).includes(action)

export async function handleBoardApi(env: Env, ctx: ExecutionContext, request: Request, action: Action): Promise<Response> {
  const req = await readApi<Body>(env, request)
  if (req instanceof Response) return req
  if (!env.BOARD_SALT) return fail(503, 'not-configured')
  if (ADMIN_ONLY.includes(action) && !req.admin) return fail(403, 'forbidden')

  const member = await env.DB.prepare('SELECT * FROM board_members WHERE user_id = ?').bind(req.profile.id).first<Member>()
  const call: Call = { env, ctx, req, member, now: Date.now() }
  if (action === 'enter') return enter(call)
  if (action === 'accept') return accept(call)
  if (!member?.rules_accepted_at) return fail(403, 'rules')

  const until = bannedUntil(call)
  if (until && WRITES.includes(action)) return fail(403, 'board-banned', { until })

  if (action === 'react') return react(call)
  if (action === 'report') return report(call)
  if (action === 'delete') return remove(call)

  const board = req.body.board as BoardId
  if (WITH_BOARD.includes(action) && !visibleBoards(req.admin, member.board_grp).includes(board)) {
    return fail(403, 'board')
  }
  switch (action) {
    case 'poll':
      return poll(call, board)
    case 'send':
      return send(call, board)
    case 'stroke':
      return stroke(call, board)
    case 'undo':
      return undo(call, board)
    case 'erase':
      return erase(call, board)
    case 'clear':
      return clear(call, board)
  }
  return fail(404, 'not found')
}

// Для точки «есть новое»: время последнего сообщения на каждой видимой доске (для POST /seen)
export async function boardLatest(env: Env, userId: number, admin: boolean, group: string | null) {
  const latest = (board: BoardId) =>
    `(SELECT created_at FROM board_messages WHERE board = '${board}' AND deleted = 0 AND hidden = 0
      ORDER BY created_at DESC LIMIT 1) AS "${board}"`
  const row = await env.DB.prepare(
    `SELECT (SELECT board_grp FROM board_members WHERE user_id = ?1) AS grp, ${BOARD_IDS.map(latest).join(', ')}`,
  )
    .bind(userId)
    .first<Record<string, number | string | null>>()
  if (!row) return {}
  const boards = visibleBoards(admin, (row.grp as string | null) ?? validGroup(group))
  return Object.fromEntries(boards.filter((board) => row[board]).map((board) => [board, row[board] as number]))
}
