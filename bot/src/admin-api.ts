// Админ-панель в мини-приложении: POST /admin/<действие>, тело — {initData, ...}.
// Каждый запрос проверяет подпись Telegram и OWNER_ID (readApi adminOnly) — остальным 403.
import { exportUsers } from './admin'
import { CORS, json, readApi, type ApiRequest } from './api'
import { clearCanvas } from './board'
import { BOARD_IDS, type BoardId } from './board-config'
import { FOREVER, moderate, setBoardBan, type ModerationAction } from './board-moderation'
import { audienceCount, audienceCounts, audienceTitle, broadcastHistory, panelBroadcast, type Audience } from './broadcast'
import { loadChats } from './chats'
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import { getUser } from './db'
import { addEdits, deleteEdit, editProblem, type NewEdit, type ScheduleEdit } from './edits'
import { isOwner } from './auth'
import { loadTimetable } from './schedule'
import { htmlProblem, loadSettings, renderGreeting, saveSettings, type Settings } from './settings'
import { TelegramError, sendMessage } from './telegram'
import { escapeHtml } from './util'

const DAY_MS = 86_400_000
const MSK_OFFSET_MS = 3 * 3_600_000

type Body = Record<string, unknown>
type Call = { env: Env; ctx: ExecutionContext; req: ApiRequest<Body> }

const asInt = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
const fail = (status: number, error: string) => json({ ok: false, error }, status)
const mskDate = (ms: number) => new Date(ms + MSK_OFFSET_MS).toISOString().slice(0, 10)

// ---------- дашборд ----------

async function dashboard({ env }: Call): Promise<Response> {
  const now = Date.now()
  const [users, newUsers, hours, calendar, board] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(last_seen >= ?1), 0) AS day, COALESCE(SUM(last_seen >= ?2), 0) AS week,
              COALESCE(SUM(last_seen >= ?3), 0) AS month, COALESCE(SUM(visits), 0) AS opens,
              COALESCE(SUM(grp = ?4), 0) AS g11, COALESCE(SUM(grp = ?5), 0) AS g12,
              COALESCE(SUM(role = 'teacher'), 0) AS teachers,
              COALESCE(SUM(grp IS NOT NULL AND grp NOT IN (?4, ?5) AND COALESCE(role, '') != 'teacher'), 0) AS other,
              COALESCE(SUM(banned), 0) AS banned, COALESCE(SUM(blocked_bot), 0) AS blocked
       FROM users`,
    ).bind(now - DAY_MS, now - 7 * DAY_MS, now - 30 * DAY_MS, MB_IDS[0], MB_IDS[1]),
    env.DB.prepare(
      `SELECT date((first_seen + ?2) / 1000, 'unixepoch') AS day, COUNT(*) AS n
       FROM users WHERE first_seen >= ?1 GROUP BY day`,
    ).bind(now - 30 * DAY_MS, MSK_OFFSET_MS),
    env.DB.prepare(
      `SELECT CAST(strftime('%H', (ts + ?2) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n
       FROM visits WHERE kind = 'open' AND ts >= ?1 GROUP BY hour`,
    ).bind(now - 30 * DAY_MS, MSK_OFFSET_MS),
    env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(last_fetch_at >= ?), 0) AS active FROM calendar_tokens').bind(
      now - DAY_MS,
    ),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM board_members WHERE rules_accepted_at IS NOT NULL) AS members,
              (SELECT COUNT(*) FROM board_messages WHERE created_at >= ?1) AS messages_day,
              (SELECT COUNT(*) FROM board_messages WHERE created_at >= ?2) AS messages_week,
              (SELECT COUNT(*) FROM board_strokes WHERE created_at >= ?1) AS strokes_day,
              (SELECT COUNT(*) FROM board_strokes WHERE created_at >= ?2) AS strokes_week,
              (SELECT COUNT(DISTINCT message_id) FROM board_reports WHERE status = 'open') AS reports`,
    ).bind(now - DAY_MS, now - 7 * DAY_MS),
  ])
  const perDay = new Map((newUsers.results as { day: string; n: number }[]).map((r) => [r.day, r.n]))
  const perHour = new Map((hours.results as { hour: number; n: number }[]).map((r) => [r.hour, r.n]))
  const chats = Object.values(await loadChats(env))
  return json({
    ok: true,
    users: users.results[0],
    new_by_day: Array.from({ length: 30 }, (_, i) => {
      const day = mskDate(now - (29 - i) * DAY_MS)
      return { day, n: perDay.get(day) ?? 0 }
    }),
    opens_by_hour: Array.from({ length: 24 }, (_, hour) => perHour.get(hour) ?? 0),
    chats: {
      total: chats.length,
      g11: chats.filter((c) => c.group === MB_IDS[0]).length,
      g12: chats.filter((c) => c.group === MB_IDS[1]).length,
      digests: chats.filter((c) => c.group && c.time).length,
    },
    calendar: calendar.results[0],
    board: board.results[0],
  })
}

// ---------- пользователи ----------

async function users({ env }: Call): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, username, name, grp, first_seen, last_seen, visits, starts, can_message,
            blocked_bot, banned, ban_reason, board_banned_until, role, teacher_id, access
     FROM users ORDER BY last_seen DESC`,
  ).all()
  return json({ ok: true, users: results })
}

async function userCard(env: Env, id: number): Promise<Response> {
  const user = await getUser(env.DB, id)
  if (!user) return fail(404, 'not found')
  const [visits, total, member, messages, calendar] = await env.DB.batch([
    env.DB.prepare('SELECT ts, kind FROM visits WHERE user_id = ? ORDER BY ts DESC LIMIT 30').bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id = ?').bind(id),
    env.DB.prepare('SELECT rules_accepted_at, board_grp FROM board_members WHERE user_id = ?').bind(id),
    env.DB.prepare(
      'SELECT id, board, alias, text, created_at, deleted, hidden FROM board_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    ).bind(id),
    env.DB.prepare('SELECT grp, created_at, last_fetch_at, fetch_count FROM calendar_tokens WHERE user_id = ?').bind(id),
  ])
  return json({
    ok: true,
    user: { ...user, owner: isOwner(env, id) },
    visits: visits.results,
    visit_log_total: (total.results[0] as { n: number }).n,
    board: member.results[0] ?? null,
    messages: messages.results,
    calendar: calendar.results[0] ?? null,
  })
}

async function user({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  return id === null ? fail(400, 'bad request') : userCard(env, id)
}

async function ban({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  if (isOwner(env, id)) return fail(400, 'self')
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) || null : null
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, first_seen, last_seen, banned, ban_reason, banned_at) VALUES (?1, ?2, ?2, 1, ?3, ?2)
     ON CONFLICT (id) DO UPDATE SET banned = 1, ban_reason = ?3, banned_at = ?2`,
  )
    .bind(id, now, reason)
    .run()
  return userCard(env, id)
}

async function unban({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  await env.DB.prepare('UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?').bind(id).run()
  return userCard(env, id)
}

// days: null — навсегда, 0 — снять бан, N — на N дней
async function boardBan({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const days = req.body.days === null ? null : asInt(req.body.days)
  if (id === null || (days !== null && (days < 0 || days > 3650)) || (req.body.days !== null && days === null)) {
    return fail(400, 'bad request')
  }
  if (isOwner(env, id)) return fail(400, 'self')
  await setBoardBan(env, id, days === 0 ? null : days === null ? FOREVER : Date.now() + days * DAY_MS)
  return userCard(env, id)
}

// Доступ (будущая оплата, сейчас не влияет ни на что): выдать / забрать free_forever вручную
async function access({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const value = req.body.access
  if (id === null || (value !== 'free_forever' && value !== 'standard')) return fail(400, 'bad request')
  const { meta } = await env.DB.prepare('UPDATE users SET access = ? WHERE id = ?').bind(value, id).run()
  if (!meta.changes) return fail(404, 'not found')
  return userCard(env, id)
}

async function exportCsv({ env }: Call): Promise<Response> {
  await exportUsers(env, Number(env.OWNER_ID))
  return json({ ok: true })
}

// ---------- рассылка ----------

async function broadcastInfo({ env }: Call): Promise<Response> {
  const [counts, history] = await Promise.all([audienceCounts(env.DB), broadcastHistory(env, 20)])
  return json({
    ok: true,
    counts,
    history: history.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      text: row.text,
      photo: Boolean(row.photo),
      audience: row.audience,
      audience_title: audienceTitle(row.audience),
      status: row.status,
      total: row.total,
      delivered: row.delivered,
      blocked: row.blocked,
      failed: row.failed,
      finished_at: row.finished_at,
    })),
  })
}

function decodeImage(value: unknown): Uint8Array | null | 'bad' {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return 'bad'
  try {
    const bytes = Uint8Array.from(atob(value.replace(/^data:image\/\w+;base64,/, '')), (ch) => ch.charCodeAt(0))
    return bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 ? bytes : 'bad'
  } catch {
    return 'bad'
  }
}

// Аудитория из запроса: 'all' | '1-1' | '1-2' | {level, form, course, institute, group}; иначе null
function parseAudience(value: unknown): Audience | null {
  if (value === 'all' || value === '1-1' || value === '1-2') return value
  if (!value || typeof value !== 'object') return null
  const f = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (f.level === 'bachelor' || f.level === 'master' || f.level === 'postgrad') out.level = f.level
  if (f.form === 'ofo' || f.form === 'ozfo') out.form = f.form
  if (typeof f.course === 'number' && f.course >= 1 && f.course <= 6) out.course = f.course
  if (typeof f.institute === 'string' && f.institute.length <= 20) out.institute = f.institute
  const group = normalizeGroup(f.group)
  if (group) out.group = group
  return Object.keys(out).length ? (out as Audience) : 'all'
}

async function broadcastCount({ env, req }: Call): Promise<Response> {
  const audience = parseAudience(req.body.audience)
  if (!audience) return fail(400, 'bad request')
  return json({ ok: true, count: await audienceCount(env, audience) })
}

// audience: см. parseAudience — отправить; null — только предпросмотр себе
async function broadcast({ env, ctx, req }: Call): Promise<Response> {
  const raw = req.body.audience ?? null
  const audience = raw === null ? null : parseAudience(raw)
  if (raw !== null && !audience) return fail(400, 'bad request')
  const photo = decodeImage(req.body.photo)
  if (photo === 'bad') return fail(400, 'Не получилось прочитать фото')
  const text = typeof req.body.text === 'string' ? req.body.text : ''
  const result = await panelBroadcast(env, ctx, { text, photo, audience })
  if (result.error) return json({ ok: false, error: result.error }, 400)
  return json({ ok: true, id: result.id ?? null, total: result.total ?? null })
}

// ---------- модерация доски ----------

async function reports({ env }: Call): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.board, m.alias, m.text, m.created_at, m.hidden, m.user_id, u.name, u.username,
            COUNT(r.id) AS reports, MAX(r.created_at) AS last_report
     FROM board_reports r
     JOIN board_messages m ON m.id = r.message_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE r.status = 'open' AND m.deleted = 0
     GROUP BY m.id ORDER BY last_report DESC LIMIT 100`,
  ).all()
  return json({ ok: true, reports: results })
}

async function moderation({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const action = req.body.action
  if (id === null || (action !== 'del' && action !== 'ban' && action !== 'ign')) return fail(400, 'bad request')
  return json({ ok: true, result: await moderate(env, id, action as ModerationAction) })
}

// лента всех досок с настоящими авторами
async function feed({ env, req }: Call): Promise<Response> {
  const board = BOARD_IDS.includes(req.body.board as BoardId) ? (req.body.board as string) : null
  const before = asInt(req.body.before) ?? Number.MAX_SAFE_INTEGER
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.board, m.alias, m.text, m.created_at, m.hidden, m.user_id, u.name, u.username
     FROM board_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.deleted = 0 AND (?1 IS NULL OR m.board = ?1) AND m.id < ?2
     ORDER BY m.id DESC LIMIT 50`,
  )
    .bind(board, before)
    .all()
  return json({ ok: true, messages: results, has_more: results.length === 50 })
}

// штрихи холста — чтобы приложение нарисовало снимок перед очисткой
async function strokes({ env, req }: Call): Promise<Response> {
  const board = req.body.board as BoardId
  if (!BOARD_IDS.includes(board)) return fail(400, 'bad request')
  const { results } = await env.DB.prepare(
    'SELECT id, color, width, points FROM board_strokes WHERE board = ? AND deleted = 0 ORDER BY id',
  )
    .bind(board)
    .all<{ id: number; color: string; width: number; points: string }>()
  const items = results.map((s) => `{"id":${s.id},"c":${JSON.stringify(s.color)},"w":${s.width},"p":${s.points},"mine":false}`)
  return new Response(`{"ok":true,"strokes":[${items.join(',')}]}`, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function clear({ env, ctx, req }: Call): Promise<Response> {
  const board = req.body.board as BoardId
  if (!BOARD_IDS.includes(board)) return fail(400, 'bad request')
  return clearCanvas(env, ctx, board, req.body.png)
}

async function snapshots({ env }: Call): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM board_snapshots ORDER BY id DESC LIMIT 100').all()
  return json({ ok: true, snapshots: results })
}

// сама картинка — байтами (в <img> её не вставить: нужен initData в теле запроса)
async function snapshot({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const png = id === null ? null : await env.KV.get(`board-snapshot:${id}`, 'arrayBuffer')
  if (!png) return fail(404, 'not found')
  return new Response(png, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } })
}

// ---------- расписание ----------

function github(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const base = env.GITHUB_API || 'https://api.github.com'
  return fetch(`${base}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      'User-Agent': 'guu-schedule-bot',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

type Run = { id: number; event: string; status: string; conclusion: string | null; created_at: string; html_url: string }

async function workflowRuns(env: Env): Promise<{ runs: Run[] | null; error: string | null }> {
  try {
    const res = await github(env, `/actions/workflows/${env.GITHUB_WORKFLOW}/runs?per_page=6`)
    if (!res.ok) return { runs: null, error: `GitHub ответил ${res.status}` }
    const data = (await res.json()) as { workflow_runs?: Run[] }
    const runs = (data.workflow_runs ?? []).map(({ id, event, status, conclusion, created_at, html_url }) => ({
      id,
      event,
      status,
      conclusion,
      created_at,
      html_url,
    }))
    return { runs, error: null }
  } catch (err) {
    return { runs: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function editList(env: Env): Promise<ScheduleEdit[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, grp AS "group", date, start, kind, text, created_at FROM schedule_edits ORDER BY date DESC, start, id',
  ).all<ScheduleEdit>()
  return results.map((e) => ({ ...e, group: normalizeGroup(e.group) ?? e.group }))
}

async function schedule({ env }: Call): Promise<Response> {
  const [tt, edits, gh] = await Promise.all([loadTimetable(env, MB_IDS), editList(env), workflowRuns(env)])
  const s = tt.schedule
  return json({
    ok: true,
    updated_at: s.updated_at ?? null,
    source_file: s.source_file ?? null,
    source_sha256: s.source_sha256 ?? null,
    lessons: s.lessons.length,
    edits,
    // замены дней целиком из файлов репозитория — в панели с пометкой «из файла», удалить нельзя
    file_edits: tt.replacements.map(({ file, group, weekday, even, odd }) => ({
      file,
      group: normalizeGroup(group) ?? group,
      weekday,
      even,
      odd,
    })),
    github: { token: Boolean(env.GITHUB_TOKEN), runs: gh.runs, error: gh.error },
  })
}

// «Обновить сейчас» — запуск workflow на GitHub (update.py скачает файл с guu.ru и пересоберёт сайт)
async function updateNow({ env, req }: Call): Promise<Response> {
  if (!env.GITHUB_TOKEN) return fail(400, 'no-token')
  const res = await github(env, `/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { force: String(req.body.force === true) } }),
  })
  if (res.status === 204) return json({ ok: true })
  const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? ''
  const reason =
    res.status === 401
      ? 'GitHub не принял токен — проверьте GITHUB_TOKEN'
      : res.status === 403 || res.status === 404
        ? 'У токена нет доступа к Actions этого репозитория'
        : `GitHub ответил ${res.status}`
  return json({ ok: false, error: `${reason}${detail ? ` (${detail})` : ''}` }, 502)
}

async function editAdd({ env, req }: Call): Promise<Response> {
  const body = req.body as Partial<NewEdit>
  // старая админ-панель присылает имена групп («МБ(МП) 1-1») — переводим в id
  const edit = { ...body, groups: Array.isArray(body.groups) ? body.groups.map((g) => normalizeGroup(g) ?? String(g)) : body.groups }
  const problem = editProblem(edit)
  if (problem) return json({ ok: false, error: problem }, 400)
  await addEdits(env, { ...(edit as NewEdit), text: (edit.text as string | undefined) ?? '' })
  return json({ ok: true, edits: await editList(env) })
}

async function editDelete({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  await deleteEdit(env, id)
  return json({ ok: true, edits: await editList(env) })
}

// ---------- настройки ----------

async function settings({ env }: Call): Promise<Response> {
  return json({ ok: true, settings: await loadSettings(env, true) })
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

async function settingsSave({ env, req }: Call): Promise<Response> {
  const body = req.body as { greetings?: unknown; maintenance?: { on?: unknown; text?: unknown }; notice?: { on?: unknown; text?: unknown } }
  const greetings = Array.isArray(body.greetings) ? body.greetings.map((g) => str(g, 3500)) : []
  if (greetings.length !== 3 || greetings.some((g) => !g)) return json({ ok: false, error: 'Нужны все три приветствия' }, 400)
  for (const [i, g] of greetings.entries()) {
    const problem = htmlProblem(g)
    if (problem) return json({ ok: false, error: `Приветствие ${i + 1}: ${problem}` }, 400)
  }
  const current = await loadSettings(env, true)
  const noticeText = str(body.notice?.text, 300)
  const noticeOn = body.notice?.on === true && Boolean(noticeText)
  const next: Settings = {
    greetings,
    maintenance: { on: body.maintenance?.on === true, text: str(body.maintenance?.text, 500) || current.maintenance.text },
    // новый текст или повторное включение — снова показываем всем (даже тем, кто закрыл прошлое)
    notice: {
      on: noticeOn,
      text: noticeText,
      id: noticeOn && (!current.notice.on || noticeText !== current.notice.text) ? Date.now() : current.notice.id,
    },
  }
  await saveSettings(env, next)
  return json({ ok: true, settings: next })
}

// приветствие — себе в личку, как его увидят на /start (Telegram заодно проверит HTML)
async function greetingPreview({ env, req }: Call): Promise<Response> {
  const text = str(req.body.text, 3500)
  if (!text) return fail(400, 'Пустой текст')
  const problem = htmlProblem(text)
  if (problem) return json({ ok: false, error: problem }, 400)
  try {
    await sendMessage(env, Number(env.OWNER_ID), renderGreeting(text, escapeHtml(req.profile.name?.split(' ')[0] || 'брат')), {
      reply_markup: { inline_keyboard: [[{ text: '📅 Открыть расписание', web_app: { url: env.WEBAPP_URL } }]] },
    })
  } catch (err) {
    if (err instanceof TelegramError && err.code === 400) return json({ ok: false, error: `Telegram: ${err.description}` }, 400)
    throw err
  }
  return json({ ok: true })
}

// ---------- маршрутизация ----------

const HANDLERS: Record<string, (call: Call) => Promise<Response>> = {
  dashboard,
  users,
  user,
  ban,
  unban,
  'board-ban': boardBan,
  access,
  export: exportCsv,
  'broadcast-info': broadcastInfo,
  'broadcast-count': broadcastCount,
  broadcast,
  reports,
  moderate: moderation,
  feed,
  strokes,
  clear,
  snapshots,
  snapshot,
  schedule,
  'update-now': updateNow,
  'edit-add': editAdd,
  'edit-delete': editDelete,
  settings,
  'settings-save': settingsSave,
  'greeting-preview': greetingPreview,
}

export async function handleAdminApi(env: Env, ctx: ExecutionContext, request: Request, action: string): Promise<Response> {
  // сначала подпись и OWNER_ID: чужим — 403 на любой адрес, даже несуществующий
  const req = await readApi<Body>(env, request, { adminOnly: true })
  if (req instanceof Response) return req
  const handler = HANDLERS[action]
  if (!handler) return fail(404, 'not found')
  return handler({ env, ctx, req })
}
