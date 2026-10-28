// Админ-панель в мини-приложении: POST /admin/<действие>, тело — {initData, ...}.
// Каждый запрос проверяет подпись Telegram и OWNER_ID (readApi adminOnly) — остальным 403.
import { exportUsers } from './admin'
import { json, readApi, type ApiRequest } from './api'
import { audienceCount, audienceCounts, audienceTitle, broadcastHistory, panelBroadcast, type Audience } from './broadcast'
import { loadChats } from './chats'
import { FOREVER, moderateReview, reviewStats, setReviewBan, type ReviewAction } from './reviews'
import { academicReset, academicSave, loadCalendarEdits } from './academic'
import { loadPlaceEdits, placeReset, placeSave } from './places'
import { hiddenOverview, hideForGroup, unhideForGroup } from './hidden'
import { loadTranslationEdits, translationSave } from './translations'
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import { getUser } from './db'
import { ADMIN_LIMIT } from './guard'
import { logAdmin } from './journal'
import { cleanEditData, editProblem, type EditKind, type NewEdit, type ScheduleEdit } from '../../shared/edits-core'
import { addEdits, editFromRow, revertEdit } from './edits'
import { isOwner } from './auth'
import { loadGroupFile, loadTeachersIndex, loadTimetable } from './schedule'
import { htmlProblem, loadSettings, renderGreeting, saveSettings, type Settings } from './settings'
import { TelegramError, sendMessage } from './telegram'
import { escapeHtml } from './util'
import { setupBot, webhookCheck } from './setup'
import { github } from './github'

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
  const reviewsPromise = reviewStats(env)
  const [users, newUsers, hours, calendar] = await env.DB.batch([
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
    reviews: await reviewsPromise,
  })
}

// ---------- пользователи ----------

async function users({ env }: Call): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, username, name, grp, first_seen, last_seen, visits, starts, can_message,
            blocked_bot, banned, ban_reason, review_banned_until, role, teacher_id, access, starosta_of
     FROM users ORDER BY last_seen DESC`,
  ).all()
  return json({ ok: true, users: results })
}

async function userCard(env: Env, id: number): Promise<Response> {
  const user = await getUser(env.DB, id)
  if (!user) return fail(404, 'not found')
  const [visits, total, calendar, reviews] = await env.DB.batch([
    env.DB.prepare('SELECT ts, kind FROM visits WHERE user_id = ? ORDER BY ts DESC LIMIT 30').bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id = ?').bind(id),
    env.DB.prepare('SELECT grp, created_at, last_fetch_at, fetch_count FROM calendar_tokens WHERE user_id = ?').bind(id),
    env.DB.prepare(
      'SELECT id, teacher_id, rating, text, discipline, created_at, deleted, hidden FROM teacher_reviews WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    ).bind(id),
  ])
  return json({
    ok: true,
    user: { ...user, owner: isOwner(env, id) },
    visits: visits.results,
    visit_log_total: (total.results[0] as { n: number }).n,
    calendar: calendar.results[0] ?? null,
    reviews: reviews.results,
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

// бан в отзывах о преподавателях. days: null — навсегда, 0 — снять бан, N — на N дней
async function reviewBan({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const days = req.body.days === null ? null : asInt(req.body.days)
  if (id === null || (days !== null && (days < 0 || days > 3650)) || (req.body.days !== null && days === null)) {
    return fail(400, 'bad request')
  }
  if (isOwner(env, id)) return fail(400, 'self')
  await setReviewBan(env, id, days === 0 ? null : days === null ? FOREVER : Date.now() + days * DAY_MS)
  return userCard(env, id)
}

// «Сбросить мой онбординг» — владелец снова увидит знакомство (для проверки); CloudStorage чистит приложение
async function resetIntro({ env, req }: Call): Promise<Response> {
  // и выбранный язык: знакомство после сброса начнётся с «Выбери язык / Choose language»
  await env.DB.prepare('UPDATE users SET intro_version = 0, lang = NULL WHERE id = ?').bind(req.profile.id).run()
  return json({ ok: true })
}

// Доступ (ни на что не влияет): выдать / забрать free_forever вручную
async function access({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const value = req.body.access
  if (id === null || (value !== 'free_forever' && value !== 'standard')) return fail(400, 'bad request')
  const { meta } = await env.DB.prepare('UPDATE users SET access = ? WHERE id = ?').bind(value, id).run()
  if (!meta.changes) return fail(404, 'not found')
  return userCard(env, id)
}

// Староста: группа (правки только её) или null — снять
async function starosta({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  const group = req.body.group === null ? null : normalizeGroup(req.body.group)
  if (req.body.group !== null && (!group || !(await loadGroupFile(env, group)))) return fail(400, 'Нет такой группы')
  const { meta } = await env.DB.prepare('UPDATE users SET starosta_of = ? WHERE id = ?').bind(group, id).run()
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
      text_en: row.text_en ?? null,
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
  const textEn = typeof req.body.text_en === 'string' ? req.body.text_en : null
  const result = await panelBroadcast(env, ctx, { text, text_en: textEn, photo, audience })
  if (result.error) return json({ ok: false, error: result.error }, 400)
  return json({ ok: true, id: result.id ?? null, total: result.total ?? null })
}

// ---------- отзывы о преподавателях ----------

// лента всех отзывов (и скрытых) с авторами и открытыми жалобами; reports — только с жалобами
async function reviews({ env, req }: Call): Promise<Response> {
  const before = asInt(req.body.before) ?? Number.MAX_SAFE_INTEGER
  const onlyReported = req.body.reports === true
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.teacher_id, r.user_id, r.grp, r.rating, r.text, r.discipline, r.created_at, r.updated_at, r.hidden,
            u.name, u.username,
            (SELECT COUNT(*) FROM review_reports p WHERE p.review_id = r.id AND p.status = 'open') AS reports
     FROM teacher_reviews r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.deleted = 0 AND r.id < ?1 AND (?2 = 0 OR r.id IN (SELECT review_id FROM review_reports WHERE status = 'open'))
     ORDER BY r.id DESC LIMIT 50`,
  )
    .bind(before, onlyReported ? 1 : 0)
    .all<{ teacher_id: string }>()
  // имена преподавателей — из teachers.json (кэш 10 минут)
  const names = new Map((await loadTeachersIndex(env).catch(() => ({ teachers: [] }))).teachers.map((t) => [t.id, t.name]))
  return json({
    ok: true,
    reviews: results.map((r) => ({ ...r, teacher_name: names.get(r.teacher_id) ?? r.teacher_id })),
    has_more: results.length === 50,
  })
}

async function reviewModerate({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  const action = req.body.action
  if (id === null || (action !== 'del' && action !== 'ban' && action !== 'keep')) return fail(400, 'bad request')
  return json({ ok: true, result: await moderateReview(env, id, action as ReviewAction) })
}

// ---------- расписание ----------


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

// Все правки (и старост) — с автором; откаченные — с отметкой, последние 300
async function editList(env: Env): Promise<(ScheduleEdit & { created_at: number; reverted_at: number | null; author_id: number | null })[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.grp, e.date, e.start, e.kind, e.text, e.data, e.created_at, e.author_id, e.reverted_at, u.name, u.username
     FROM schedule_edits e LEFT JOIN users u ON u.id = e.author_id
     ORDER BY e.reverted_at IS NOT NULL, e.date DESC, e.start, e.id LIMIT 300`,
  ).all<Parameters<typeof editFromRow>[0] & { name: string | null; username: string | null }>()
  return results.map((r) => ({
    ...editFromRow(r, r.author_id ? (r.username ? `@${r.username}` : (r.name ?? `id ${r.author_id}`)) : null),
    reverted_at: r.reverted_at,
    author_id: r.author_id,
  }))
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
  const groups = Array.isArray(body.groups) ? body.groups.map((g) => normalizeGroup(g)).filter((g): g is string => Boolean(g)) : []
  const kind = (body.kind ?? 'note') as EditKind
  const edit = { ...body, groups, kind, data: cleanEditData(kind, body.data), text: typeof body.text === 'string' ? body.text : '' }
  const problem = editProblem(edit)
  if (problem) return json({ ok: false, error: problem }, 400)
  await addEdits(env, edit as NewEdit, null)
  return json({ ok: true, edits: await editList(env) })
}

async function editDelete({ env, req }: Call): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  await revertEdit(env, id) // «откатить»: правка перестаёт действовать, в истории остаётся
  return json({ ok: true, edits: await editList(env) })
}

// ---------- настройки ----------

async function settings({ env }: Call): Promise<Response> {
  return json({ ok: true, settings: await loadSettings(env, true) })
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

async function settingsSave({ env, req }: Call): Promise<Response> {
  const body = req.body as {
    greetings?: unknown
    maintenance?: { on?: unknown; text?: unknown; text_en?: unknown }
    notice?: { on?: unknown; text?: unknown; text_en?: unknown }
    channel?: unknown
  }
  const greetings = Array.isArray(body.greetings) ? body.greetings.map((g) => str(g, 3500)) : []
  if (greetings.length !== 3 || greetings.some((g) => !g)) return json({ ok: false, error: 'Нужны все три приветствия' }, 400)
  for (const [i, g] of greetings.entries()) {
    const problem = htmlProblem(g)
    if (problem) return json({ ok: false, error: `Приветствие ${i + 1}: ${problem}` }, 400)
  }
  const current = await loadSettings(env, true)
  // канал новостей: только ссылка на Telegram (её откроет приложение)
  const channel = str(body.channel, 200).replace(/^@([A-Za-z0-9_]{4,})$/, 'https://t.me/$1')
  if (channel && !/^https:\/\/t\.me\/[A-Za-z0-9_+/-]{3,}$/.test(channel)) {
    return json({ ok: false, error: 'Канал новостей: нужна ссылка вида https://t.me/имя_канала или @имя_канала' }, 400)
  }
  const noticeText = str(body.notice?.text, 300)
  const noticeEn = str(body.notice?.text_en, 300)
  const noticeOn = body.notice?.on === true && Boolean(noticeText)
  const next: Settings = {
    greetings,
    maintenance: {
      on: body.maintenance?.on === true,
      text: str(body.maintenance?.text, 500) || current.maintenance.text,
      text_en: str(body.maintenance?.text_en, 500),
    },
    // новый текст или повторное включение — снова показываем всем (даже тем, кто закрыл прошлое)
    notice: {
      on: noticeOn,
      text: noticeText,
      text_en: noticeEn,
      id:
        noticeOn && (!current.notice.on || noticeText !== current.notice.text || noticeEn !== (current.notice.text_en ?? ''))
          ? Date.now()
          : current.notice.id,
    },
    channel,
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

// только чтение — в журнал не пишем
const READ_ONLY = new Set([
  'dashboard', 'users', 'user', 'reviews', 'schedule', 'broadcast-info', 'broadcast-count', 'places',
  'academic', 'hidden', 'translations', 'bot-status',
])

// «Скрытые пары»: что люди скрывают у себя (подсказка — ≥ 60% группы) и что скрыто для всей группы
const hidden = async ({ env }: Call) => json({ ok: true, ...(await hiddenOverview(env)) })

const HANDLERS: Record<string, (call: Call) => Promise<Response>> = {
  dashboard,
  // бот в Telegram: состояние вебхука и «Переустановить» (адрес — только из конфигурации, setup.ts)
  'bot-status': async ({ env }) => json({ ok: true, ...(await webhookCheck(env)) }),
  'bot-setup': async ({ env }) => {
    await setupBot(env, true)
    return json({ ok: true, ...(await webhookCheck(env)) })
  },
  users,
  user,
  ban,
  unban,
  'review-ban': reviewBan,
  'reset-intro': resetIntro,
  places: async ({ env }) => json({ ok: true, edits: await loadPlaceEdits(env) }),
  academic: async ({ env }) => json({ ok: true, edits: await loadCalendarEdits(env) }),
  'academic-save': ({ env, req }) => academicSave(env, req.body as Record<string, unknown>),
  'academic-reset': ({ env, req }) => academicReset(env, req.body as Record<string, unknown>),
  'place-save': ({ env, req }) => placeSave(env, req.body as Record<string, unknown>),
  'place-reset': ({ env, req }) => placeReset(env, req.body as Record<string, unknown>),
  access,
  starosta,
  export: exportCsv,
  'broadcast-info': broadcastInfo,
  'broadcast-count': broadcastCount,
  broadcast,
  reviews,
  'review-moderate': reviewModerate,
  schedule,
  'update-now': updateNow,
  'edit-add': editAdd,
  'edit-delete': editDelete,
  settings,
  'settings-save': settingsSave,
  'greeting-preview': greetingPreview,
  hidden,
  translations: async ({ env }) => json({ ok: true, edits: await loadTranslationEdits(env) }),
  'translation-save': ({ env, req }) => translationSave(env, req.body),
  'hidden-group-add': async (call) => {
    const problem = await hideForGroup(call.env, call.req.body)
    return problem ? fail(400, problem) : hidden(call)
  },
  'hidden-group-delete': async (call) => {
    await unhideForGroup(call.env, call.req.body.id)
    return hidden(call)
  },
}

export async function handleAdminApi(env: Env, ctx: ExecutionContext, request: Request, action: string): Promise<Response> {
  // сначала подпись и OWNER_ID: чужим — 403 на любой адрес, даже несуществующий
  const req = await readApi<Body>(env, request, { adminOnly: true, maxBody: ADMIN_LIMIT })
  if (req instanceof Response) return req
  const handler = HANDLERS[action]
  if (!handler) return fail(404, 'not found')
  const response = await handler({ env, ctx, req })
  // изменения — в журнал действий (что и с какими полями; фото рассылки и длинные тексты — обрезаны)
  if (!READ_ONLY.has(action) && response.ok) {
    const { photo: _, ...fields } = req.body as Record<string, unknown>
    await logAdmin(env, req.profile.id, `admin/${action}`, (fields.id ?? fields.scope ?? null) as string | number | null, fields)
  }
  return response
}
