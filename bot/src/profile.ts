// Выбор в онбординге и «Сменить группу / роль»: POST /profile {initData, role, group | teacher}.
// Группа и преподаватель должны быть на сайте (data/schedule/<id>.json, data/teachers/<id>.json).
// Тот же выбор приложение кладёт и в CloudStorage Telegram — здесь он для бота: /today, inline, рассылки.
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import { isLang } from '../../shared/i18n-core'
import { json, readApi } from './api'
import { forgetCalendarOf } from './calendar'
import { getUser, meOf } from './db'
import { loadGroupFile, loadTeacherFile } from './schedule'

type Body = { role?: unknown; group?: unknown; teacher?: unknown }

export async function handleProfile(env: Env, request: Request): Promise<Response> {
  const req = await readApi<Body>(env, request, { write: true })
  if (req instanceof Response) return req
  const role = req.body.role === 'teacher' ? 'teacher' : req.body.role === 'student' ? 'student' : null
  if (!role) return json({ ok: false, error: 'role' }, 400)

  let group: string | null = null
  let teacher: string | null = null
  if (role === 'student') {
    group = normalizeGroup(req.body.group)
    if (!group || !(await loadGroupFile(env, group))) return json({ ok: false, error: 'group' }, 400)
  } else {
    // id преподавателя — как в teachers.json (латиница, цифры, дефисы): в путь к файлу на сайте — только он
    teacher = typeof req.body.teacher === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(req.body.teacher) ? req.body.teacher : null
    if (!teacher || !(await loadTeacherFile(env, teacher))) return json({ ok: false, error: 'teacher' }, 400)
  }
  const now = Date.now()
  // преподаватель группу не теряет (вдруг вернётся к роли студента) — меняем только своё поле
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, grp, role, teacher_id, first_seen, last_seen, onboarded_at, access)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7, CASE WHEN ?4 IN (?8, ?9) THEN 'free_forever' ELSE 'standard' END)
     ON CONFLICT (id) DO UPDATE SET
       role = ?5,
       grp = COALESCE(?4, users.grp),
       teacher_id = COALESCE(?6, users.teacher_id),
       onboarded_at = ?7,
       access = CASE WHEN ?4 IN (?8, ?9) THEN 'free_forever' ELSE users.access END`,
  )
    .bind(req.profile.id, req.profile.username, req.profile.name, group, role, teacher, now, MB_IDS[0], MB_IDS[1])
    .run()
  return json({ ok: true, me: meOf(await getUser(env.DB, req.profile.id)) })
}

// Знакомство (истории автора, подтверждение группы, тур) просмотрено: POST /intro {version}.
// Версия только растёт — со старого устройства её не откатить (сбросить может владелец себе, в админке).
export async function handleIntro(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ version?: unknown }>(env, request, { write: true })
  if (req instanceof Response) return req
  const version = typeof req.body.version === 'number' && Number.isSafeInteger(req.body.version) ? req.body.version : null
  if (version === null || version < 1 || version > 100) return json({ ok: false, error: 'version' }, 400)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, first_seen, last_seen, intro_version) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
     ON CONFLICT (id) DO UPDATE SET intro_version = MAX(users.intro_version, ?5)`,
  )
    .bind(req.profile.id, req.profile.username, req.profile.name, now, version)
    .run()
  return json({ ok: true, intro: version })
}

// Язык интерфейса (этап 11): POST /lang {lang: 'ru' | 'en'} — выбор в знакомстве или «Профиль → Язык».
// По нему бот пишет человеку: /start, /today, inline, календарь, рассылки.
export async function handleLang(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ lang?: unknown }>(env, request, { write: true })
  if (req instanceof Response) return req
  if (!isLang(req.body.lang)) return json({ ok: false, error: 'lang' }, 400)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, first_seen, last_seen, lang, lang_code) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)
     ON CONFLICT (id) DO UPDATE SET lang = ?5`,
  )
    .bind(req.profile.id, req.profile.username, req.profile.name, now, req.body.lang, req.profile.lang ?? null)
    .run()
  forgetCalendarOf(req.profile.id) // календарь на телефоне — на новом языке
  return json({ ok: true, lang: req.body.lang })
}

// Избранное над расписанием (этап 12): POST /favorites {list, at} — группы и преподаватели («t-<id>») в порядке
// ленты. Копия для других устройств (основная — в облаке Telegram, вместе с настройками); at — когда менялось:
// старое устройство не затрёт новое.
const FAVORITE = /^(t-)?[a-z0-9][a-z0-9-]{0,79}$/
export const MAX_FAVORITES = 50

export function cleanFavorites(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    // преподаватель — «t-<id>», группа — id или старое имя МБ («МБ(МП) 1-1»)
    const id = typeof item !== 'string' ? null : item.startsWith('t-') ? (FAVORITE.test(item) ? item : null) : normalizeGroup(item)
    if (!id) return null
    if (!out.includes(id)) out.push(id)
  }
  return out.length <= MAX_FAVORITES ? out : null
}

export async function handleFavorites(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ list?: unknown; at?: unknown }>(env, request, { write: true })
  if (req instanceof Response) return req
  const list = cleanFavorites(req.body.list)
  if (!list) return json({ ok: false, error: 'favorites' }, 400)
  const now = Date.now()
  // время с устройства, но не из будущего
  const at = typeof req.body.at === 'number' && Number.isSafeInteger(req.body.at) && req.body.at > 0 ? Math.min(req.body.at, now) : now
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, first_seen, last_seen, favorites, favorites_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)
     ON CONFLICT (id) DO UPDATE SET favorites = ?5, favorites_at = ?6 WHERE COALESCE(users.favorites_at, 0) <= ?6`,
  )
    .bind(req.profile.id, req.profile.username, req.profile.name, now, JSON.stringify(list), at)
    .run()
  return json({ ok: true, favorites: list, at })
}
