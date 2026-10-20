// Рейтинг преподавателей: «Ещё → Преподаватели». POST /reviews/<действие>, тело — {initData, ...}.
//
//   top — число отзывов и средняя оценка у всех, о ком писали (список и сортировка);
//   teacher — карточка: отзывы, распределение 1–5, свой отзыв, можно ли оставить и почему нет;
//   save / delete — свой отзыв (один на преподавателя: изменить, удалить); report — жалоба;
//   vote — «полезно / не полезно» (одна отметка от человека).
// Отзыв (этап 7.6): три критерия 1–5 (понятность, компетентность, коммуникация) + «рекомендую / нет»;
// общая оценка — среднее критериев (score; rating — округлённое). Старые отзывы — одна оценка rating.
//
// Оставить отзыв можно, только если преподаватель ведёт пары у группы автора или вёл их в прошлом
// семестре — по data/teachers/<id>.json (lessons[].groups и past_groups, их пишет update.py). Группа —
// из базы (users.grp), не из запроса; у роли «Преподаватель» группы нет — отзывов он не пишет.
// Авторы анонимны: обычным пользователям — ни id, ни имён, ни групп; владелец видит всё.
// Жалоба — владельцу в бот с кнопками rv:del|ban|keep; 3 жалобы от разных людей — отзыв скрыт до решения.
import { json, readApi, type ApiRequest } from './api'
import { isOwner } from './auth'
import { cleanText, passesFilter } from './board-filter'
import { FOREVER } from './board-moderation'
import { getUser, userLabel, type UserRow } from './db'
import { loadTeacherFile } from './schedule'
import { answerCallback, sendMessage, tg, type TgCallbackQuery } from './telegram'
import { escapeHtml, formatMsk } from './util'
import { normalizeGroup } from '../../shared/groups'

export const REVIEW_LIMITS = {
  textMin: 20,
  textMax: 1000,
  disciplineMax: 120,
  minForAverage: 3, // средняя ★ — только от 3 отзывов, иначе «Мало отзывов»
  reportsToHide: 3,
  perDay: 10, // новых и изменённых отзывов за сутки от одного человека
}

const DAY_MS = 86_400_000

type Body = {
  teacher?: unknown
  rating?: unknown
  clarity?: unknown
  competence?: unknown
  communication?: unknown
  recommend?: unknown
  value?: unknown
  text?: unknown
  discipline?: unknown
  confirm?: unknown
  id?: unknown
}

const fail = (status: number, error: string, extra: object = {}) => json({ ok: false, error, ...extra }, status)
const asInt = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
const validTeacherId = (value: unknown) => (typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value) ? value : null)

// бан в отзывах, если ещё идёт (владельцу банов нет)
function bannedUntil(req: ApiRequest<Body>): number | null {
  if (req.admin) return null
  const until = req.user?.review_banned_until ?? null
  return until && until > Date.now() ? until : null
}

// null — можно оставить отзыв; иначе — почему нельзя (текст для человека)
export async function reviewProblem(env: Env, user: UserRow | null, teacherId: string): Promise<string | null> {
  if (user?.role === 'teacher') return 'Отзывы оставляют студенты.'
  const group = normalizeGroup(user?.grp)
  if (!group) return 'Сначала выбери свою группу в профиле.'
  const file = await loadTeacherFile(env, teacherId)
  if (!file) return 'Не нашёл этого преподавателя в расписании ГУУ.'
  const groups = new Set([...file.lessons.flatMap((l) => l.groups), ...(file.past_groups ?? [])])
  if (!groups.has(group)) return 'Отзыв можно оставить, только если преподаватель ведёт пары у твоей группы (или вёл в прошлом семестре).'
  return null
}

// ---------- чтение ----------

type ReviewRow = {
  id: number
  teacher_id: string
  user_id: number
  grp: string | null
  rating: number
  clarity: number | null
  competence: number | null
  communication: number | null
  recommend: number | null
  score: number | null
  up?: number
  down?: number
  myvote?: number | null
  text: string
  discipline: string | null
  created_at: number
  updated_at: number
  hidden: number
  name?: string | null
  username?: string | null
  reports?: number
}

function reviewOut(row: ReviewRow, viewerId: number, admin: boolean) {
  return {
    id: row.id,
    rating: row.rating,
    score: row.score ?? row.rating,
    criteria: row.clarity ? { clarity: row.clarity, competence: row.competence, communication: row.communication } : null,
    recommend: row.recommend === null || row.recommend === undefined ? null : Boolean(row.recommend),
    helpful: { up: row.up ?? 0, down: row.down ?? 0, mine: row.myvote ?? 0 },
    text: row.text,
    discipline: row.discipline,
    at: row.created_at,
    edited: row.updated_at > row.created_at,
    mine: row.user_id === viewerId,
    hidden: Boolean(row.hidden), // видят только автор и владелец
    ...(admin
      ? { author: { id: row.user_id, name: row.name ?? null, username: row.username ?? null }, grp: row.grp, reports: row.reports ?? 0 }
      : {}),
  }
}

// Число отзывов и средняя у всех преподавателей, о ком писали; средняя — только от 3 отзывов
async function top(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT teacher_id AS t, COUNT(*) AS n, AVG(COALESCE(score, rating)) AS avg, AVG(recommend) AS rec, COUNT(recommend) AS nrec
     FROM teacher_reviews WHERE deleted = 0 AND hidden = 0 GROUP BY teacher_id`,
  ).all<{ t: string; n: number; avg: number; rec: number | null; nrec: number }>()
  const enough = (n: number) => n >= REVIEW_LIMITS.minForAverage
  return json({
    ok: true,
    teachers: results.map((r) => ({
      t: r.t,
      n: r.n,
      avg: enough(r.n) ? Math.round(r.avg * 10) / 10 : null,
      // доля «рекомендую» — от тех, кто отвечал (старые отзывы без ответа не считаются)
      rec: enough(r.n) && r.nrec ? Math.round((r.rec ?? 0) * 100) : null,
    })),
  })
}

// @ник владельца — «Вы преподаватель и не согласны с отзывом? Напишите …» (берём из базы, а не из кода)
async function ownerContact(env: Env): Promise<string | null> {
  if (!env.OWNER_ID) return null
  const row = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(Number(env.OWNER_ID)).first<{ username: string | null }>()
  return row?.username ? `@${row.username}` : null
}

async function teacherCard(env: Env, req: ApiRequest<Body>): Promise<Response> {
  const teacher = validTeacherId(req.body.teacher)
  if (!teacher) return fail(400, 'bad request')
  const me = req.profile.id
  const admin = req.admin
  const [stats, agg, rows] = await env.DB.batch([
    env.DB.prepare(
      'SELECT rating, COUNT(*) AS n FROM teacher_reviews WHERE teacher_id = ? AND deleted = 0 AND hidden = 0 GROUP BY rating',
    ).bind(teacher),
    env.DB.prepare(
      `SELECT AVG(COALESCE(score, rating)) AS avg, AVG(clarity) AS clarity, AVG(competence) AS competence,
              AVG(communication) AS communication, COUNT(clarity) AS ncrit, AVG(recommend) AS rec, COUNT(recommend) AS nrec
       FROM teacher_reviews WHERE teacher_id = ? AND deleted = 0 AND hidden = 0`,
    ).bind(teacher),
    env.DB.prepare(
      `SELECT r.id, r.teacher_id, r.user_id, r.grp, r.rating, r.clarity, r.competence, r.communication, r.recommend, r.score,
              r.text, r.discipline, r.created_at, r.updated_at, r.hidden,
              (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id AND v.value = 1) AS up,
              (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id AND v.value = -1) AS down,
              (SELECT value FROM review_votes v WHERE v.review_id = r.id AND v.user_id = ?3) AS myvote
              ${admin ? `, u.name, u.username, (SELECT COUNT(*) FROM review_reports p WHERE p.review_id = r.id AND p.status = 'open') AS reports` : ''}
       FROM teacher_reviews r ${admin ? 'LEFT JOIN users u ON u.id = r.user_id' : ''}
       WHERE r.teacher_id = ?1 AND r.deleted = 0 AND (r.hidden = 0 OR ?2 = 1 OR r.user_id = ?3)
       ORDER BY r.created_at DESC LIMIT 300`,
    ).bind(teacher, admin ? 1 : 0, me),
  ])
  const distribution = [0, 0, 0, 0, 0]
  for (const r of stats.results as { rating: number; n: number }[]) distribution[r.rating - 1] = r.n
  const count = distribution.reduce((a, b) => a + b, 0)
  const a = (agg.results as { avg: number | null; clarity: number | null; competence: number | null; communication: number | null; ncrit: number; rec: number | null; nrec: number }[])[0]
  const enough = count >= REVIEW_LIMITS.minForAverage
  const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)
  const reviews = (rows.results as ReviewRow[]).map((r) => reviewOut(r, me, admin))
  const [problem, contact] = await Promise.all([reviewProblem(env, req.user, teacher), ownerContact(env)])
  return json({
    ok: true,
    teacher,
    count,
    average: enough ? round1(a.avg) : null,
    // критерии — только по новым отзывам, тоже от 3
    criteria:
      a.ncrit >= REVIEW_LIMITS.minForAverage
        ? { clarity: round1(a.clarity), competence: round1(a.competence), communication: round1(a.communication), count: a.ncrit }
        : null,
    recommend: enough && a.nrec ? Math.round((a.rec ?? 0) * 100) : null,
    distribution,
    reviews,
    mine: reviews.find((r) => r.mine) ?? null,
    can_review: problem === null,
    reason: problem,
    banned_until: bannedUntil(req),
    contact,
    limits: { text_min: REVIEW_LIMITS.textMin, text_max: REVIEW_LIMITS.textMax },
  })
}

// ---------- запись ----------

async function save(env: Env, req: ApiRequest<Body>): Promise<Response> {
  const teacher = validTeacherId(req.body.teacher)
  if (!teacher) return fail(400, 'bad request')
  // новый отзыв — три критерия и «рекомендую»; старые версии приложения присылают одну оценку rating
  const crit = [req.body.clarity, req.body.competence, req.body.communication].map(asInt)
  const hasCriteria = crit.some((c) => c !== null)
  if (hasCriteria && crit.some((c) => c === null || c < 1 || c > 5)) return fail(400, 'Оцени все три критерия от 1 до 5')
  if (hasCriteria && typeof req.body.recommend !== 'boolean') return fail(400, 'Выбери: рекомендуешь или нет')
  const score = hasCriteria ? (crit[0]! + crit[1]! + crit[2]!) / 3 : null
  const rating = score !== null ? Math.round(score) : asInt(req.body.rating)
  if (rating === null || rating < 1 || rating > 5) return fail(400, 'Поставь оценку от 1 до 5')
  const recommend = hasCriteria ? (req.body.recommend ? 1 : 0) : null
  if (req.body.confirm !== true) return fail(400, 'Отметь, что отзыв основан на твоём опыте')
  const text = cleanText(req.body.text)
  const length = [...text].length
  if (length < REVIEW_LIMITS.textMin) return fail(400, `Напиши хотя бы ${REVIEW_LIMITS.textMin} символов`)
  if (length > REVIEW_LIMITS.textMax) return fail(400, `Не больше ${REVIEW_LIMITS.textMax} символов`)
  const discipline = cleanText(req.body.discipline).replace(/\s+/g, ' ').slice(0, REVIEW_LIMITS.disciplineMax) || null
  if (!passesFilter(text) || (discipline && !passesFilter(discipline))) return fail(400, 'Отзыв не прошёл фильтр: без мата и оскорблений')

  const problem = await reviewProblem(env, req.user, teacher)
  if (problem) return fail(403, problem)
  const now = Date.now()
  if (!req.admin) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM teacher_reviews WHERE user_id = ? AND updated_at > ?')
      .bind(req.profile.id, now - DAY_MS)
      .first<{ n: number }>()
    if ((recent?.n ?? 0) >= REVIEW_LIMITS.perDay) return fail(429, 'На сегодня хватит отзывов — продолжим завтра')
  }
  // один отзыв на преподавателя: повторная отправка меняет его. Скрытый после жалоб остаётся скрытым
  // (правкой жалобы не обойти); удалённый раньше — пишется заново
  await env.DB.prepare(
    `INSERT INTO teacher_reviews (teacher_id, user_id, grp, rating, text, discipline, created_at, updated_at,
                                  clarity, competence, communication, recommend, score)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT (teacher_id, user_id) DO UPDATE SET
       grp = excluded.grp, rating = excluded.rating, text = excluded.text, discipline = excluded.discipline,
       clarity = excluded.clarity, competence = excluded.competence, communication = excluded.communication,
       recommend = excluded.recommend, score = excluded.score,
       created_at = CASE WHEN teacher_reviews.deleted != 0 THEN excluded.created_at ELSE teacher_reviews.created_at END,
       hidden = CASE WHEN teacher_reviews.deleted != 0 THEN 0 ELSE teacher_reviews.hidden END,
       updated_at = excluded.updated_at,
       deleted = 0`,
  )
    .bind(teacher, req.profile.id, normalizeGroup(req.user?.grp), rating, text, discipline, now, crit[0], crit[1], crit[2], recommend, score)
    .run()
  return teacherCard(env, req)
}

async function remove(env: Env, req: ApiRequest<Body>): Promise<Response> {
  const teacher = validTeacherId(req.body.teacher)
  if (!teacher) return fail(400, 'bad request')
  const row = await env.DB.prepare(
    'UPDATE teacher_reviews SET deleted = 1, updated_at = ? WHERE teacher_id = ? AND user_id = ? AND deleted = 0 RETURNING id',
  )
    .bind(Date.now(), teacher, req.profile.id)
    .first<{ id: number }>()
  if (row) await env.DB.prepare("UPDATE review_reports SET status = 'deleted' WHERE review_id = ? AND status = 'open'").bind(row.id).run()
  return teacherCard(env, req)
}

async function report(env: Env, req: ApiRequest<Body>): Promise<Response> {
  const id = asInt(req.body.id)
  if (id === null) return fail(400, 'bad request')
  const review = await env.DB.prepare('SELECT * FROM teacher_reviews WHERE id = ? AND deleted = 0').bind(id).first<ReviewRow>()
  if (!review || (review.hidden && !req.admin)) return fail(404, 'Отзыв уже удалён')
  if (review.user_id === req.profile.id) return fail(400, 'На свой отзыв жаловаться нельзя')
  const now = Date.now()
  const [inserted, counted] = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO review_reports (review_id, reporter_id, created_at) VALUES (?, ?, ?)').bind(id, req.profile.id, now),
    env.DB.prepare("SELECT COUNT(*) AS n FROM review_reports WHERE review_id = ? AND status = 'open'").bind(id),
  ])
  if (inserted.meta.changes) {
    const count = (counted.results as { n: number }[])[0].n
    if (count >= REVIEW_LIMITS.reportsToHide && !review.hidden) {
      await env.DB.prepare('UPDATE teacher_reviews SET hidden = 1 WHERE id = ?').bind(id).run()
      await notifyReviewReport(env, review, count, true)
    } else if (count === 1) {
      await notifyReviewReport(env, review, count, false)
    }
  }
  return json({ ok: true })
}

// «Полезно» (1) / «Не полезно» (-1) / снять (0): одна отметка от человека, свой отзыв — нельзя
async function vote(env: Env, req: ApiRequest<Body>): Promise<Response> {
  const id = asInt(req.body.id)
  const value = asInt(req.body.value)
  if (id === null || value === null || ![-1, 0, 1].includes(value)) return fail(400, 'bad request')
  const review = await env.DB.prepare('SELECT user_id, hidden FROM teacher_reviews WHERE id = ? AND deleted = 0').bind(id).first<{ user_id: number; hidden: number }>()
  if (!review || (review.hidden && !req.admin)) return fail(404, 'Отзыв уже удалён')
  if (review.user_id === req.profile.id) return fail(400, 'Свой отзыв оценивать нельзя')
  const [, counts] = await env.DB.batch([
    value === 0
      ? env.DB.prepare('DELETE FROM review_votes WHERE review_id = ? AND user_id = ?').bind(id, req.profile.id)
      : env.DB.prepare(
          `INSERT INTO review_votes (review_id, user_id, value, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (review_id, user_id) DO UPDATE SET value = ?3`,
        ).bind(id, req.profile.id, value, Date.now()),
    env.DB.prepare(
      'SELECT COALESCE(SUM(value = 1), 0) AS up, COALESCE(SUM(value = -1), 0) AS down FROM review_votes WHERE review_id = ?',
    ).bind(id),
  ])
  const c = (counts.results as { up: number; down: number }[])[0]
  return json({ ok: true, id, helpful: { up: c.up, down: c.down, mine: value } })
}

// ---------- маршрутизация ----------

const ACTIONS = ['top', 'teacher', 'save', 'delete', 'report', 'vote'] as const
type Action = (typeof ACTIONS)[number]
const WRITES: Action[] = ['save', 'delete', 'report', 'vote']

export const isReviewAction = (action: string): action is Action => (ACTIONS as readonly string[]).includes(action)

export async function handleReviewsApi(env: Env, request: Request, action: Action): Promise<Response> {
  const req = await readApi<Body>(env, request)
  if (req instanceof Response) return req
  const until = bannedUntil(req)
  // удалить свой отзыв можно и с баном
  if (until && WRITES.includes(action) && action !== 'delete') return fail(403, 'Тебе запрещено писать отзывы', { until })
  switch (action) {
    case 'top':
      return top(env)
    case 'teacher':
      return teacherCard(env, req)
    case 'save':
      return save(env, req)
    case 'delete':
      return remove(env, req)
    case 'report':
      return report(env, req)
    case 'vote':
      return vote(env, req)
  }
}

// ---------- модерация ----------

async function teacherName(env: Env, id: string): Promise<string> {
  return (await loadTeacherFile(env, id).catch(() => null))?.name ?? id
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

// Владельцу: преподаватель, автор, оценка, текст и кнопки. Первая жалоба — и когда отзыв скрыт
async function notifyReviewReport(env: Env, review: ReviewRow, count: number, hidden: boolean): Promise<void> {
  if (!env.OWNER_ID) return
  const [author, name] = await Promise.all([getUser(env.DB, review.user_id), teacherName(env, review.teacher_id)])
  const who = author ? `${userLabel(author, escapeHtml)} (id ${author.id})` : `id ${review.user_id}`
  const title = hidden ? `🙈 <b>Отзыв скрыт после ${count} жалоб</b> — ждёт решения` : '🚩 <b>Жалоба на отзыв о преподавателе</b>'
  const text = `${title}
Преподаватель: ${escapeHtml(name)}
Автор: ${who}${review.grp ? ` · ${escapeHtml(review.grp)}` : ''}
Оценка: ${stars(review.rating)}${review.discipline ? `\nДисциплина: ${escapeHtml(review.discipline)}` : ''}
Жалоб: ${count}

<blockquote>${escapeHtml(review.text)}</blockquote>`
  await sendMessage(env, Number(env.OWNER_ID), text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑 Удалить', callback_data: `rv:del:${review.id}` }],
        [{ text: '🔇 Удалить и забанить в отзывах', callback_data: `rv:ban:${review.id}` }],
        [{ text: 'Оставить', callback_data: `rv:keep:${review.id}` }],
      ],
    },
  })
}

export async function setReviewBan(env: Env, userId: number, until: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, first_seen, last_seen, review_banned_until) VALUES (?1, ?2, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET review_banned_until = ?3`,
  )
    .bind(userId, Date.now(), until)
    .run()
}

export type ReviewAction = 'del' | 'ban' | 'keep'

// Решение по отзыву — из кнопок под жалобой и из админ-панели. Возвращает итог для показа.
export async function moderateReview(env: Env, id: number, action: ReviewAction): Promise<string> {
  const review = await env.DB.prepare('SELECT id, user_id, deleted FROM teacher_reviews WHERE id = ?')
    .bind(id)
    .first<{ id: number; user_id: number; deleted: number }>()
  if (!review || review.deleted) return 'Отзыва уже нет'
  const now = Date.now()
  if (action === 'keep') {
    await env.DB.batch([
      env.DB.prepare("UPDATE review_reports SET status = 'kept' WHERE review_id = ? AND status = 'open'").bind(id),
      env.DB.prepare('UPDATE teacher_reviews SET hidden = 0 WHERE id = ?').bind(id),
    ])
    return '👌 Оставлен'
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE teacher_reviews SET deleted = 2, updated_at = ? WHERE id = ?').bind(now, id),
    env.DB.prepare("UPDATE review_reports SET status = 'deleted' WHERE review_id = ? AND status = 'open'").bind(id),
  ])
  if (action === 'ban' && !isOwner(env, review.user_id)) {
    await setReviewBan(env, review.user_id, FOREVER)
    return '✅ Удалён, автор забанен в отзывах'
  }
  return '✅ Удалён'
}

// Кнопки под жалобой: rv:del | rv:ban | rv:keep : <id отзыва>
export async function onReviewButton(env: Env, query: TgCallbackQuery): Promise<void> {
  if (!isOwner(env, query.from.id)) return void (await answerCallback(env, query.id))
  const [, action, rawId] = (query.data ?? '').split(':')
  if (action !== 'del' && action !== 'ban' && action !== 'keep') return void (await answerCallback(env, query.id))
  const status = await moderateReview(env, Number(rawId), action)
  if (query.message) {
    await tg(env, 'editMessageReplyMarkup', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: status, callback_data: 'rv:done' }]] },
    })
  }
  await answerCallback(env, query.id, status)
}

export const reviewBanTerm = (until: number) => (until >= FOREVER ? 'навсегда' : `до ${formatMsk(until)}`)

// Для /stats и дашборда: отзывов всего, преподавателей с отзывами, за 7 дней, жалоб ждут
export async function reviewStats(env: Env) {
  return (await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM teacher_reviews WHERE deleted = 0 AND hidden = 0) AS reviews,
            (SELECT COUNT(DISTINCT teacher_id) FROM teacher_reviews WHERE deleted = 0 AND hidden = 0) AS teachers,
            (SELECT COUNT(*) FROM teacher_reviews WHERE deleted = 0 AND created_at >= ?1) AS week,
            (SELECT COUNT(DISTINCT review_id) FROM review_reports WHERE status = 'open') AS reports`,
  )
    .bind(Date.now() - 7 * DAY_MS)
    .first<{ reviews: number; teachers: number; week: number; reports: number }>())!
}
