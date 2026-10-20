// Выбор в онбординге и «Сменить группу / роль»: POST /profile {initData, role, group | teacher}.
// Группа и преподаватель должны быть на сайте (data/schedule/<id>.json, data/teachers/<id>.json).
// Тот же выбор приложение кладёт и в CloudStorage Telegram — здесь он для бота: /today, inline, рассылки.
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import { json, readApi } from './api'
import { getUser, meOf } from './db'
import { loadGroupFile, loadTeacherFile } from './schedule'

type Body = { role?: unknown; group?: unknown; teacher?: unknown }

export async function handleProfile(env: Env, request: Request): Promise<Response> {
  const req = await readApi<Body>(env, request)
  if (req instanceof Response) return req
  const role = req.body.role === 'teacher' ? 'teacher' : req.body.role === 'student' ? 'student' : null
  if (!role) return json({ ok: false, error: 'role' }, 400)

  let group: string | null = null
  let teacher: string | null = null
  if (role === 'student') {
    group = normalizeGroup(req.body.group)
    if (!group || !(await loadGroupFile(env, group))) return json({ ok: false, error: 'group' }, 400)
  } else {
    teacher = typeof req.body.teacher === 'string' ? req.body.teacher : null
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
