// Пользователи в D1 (схема — migrations/0001_init.sql).
import { MB_IDS, normalizeGroup } from '../../shared/groups'
import type { Profile } from './auth'

export type UserRow = {
  id: number
  username: string | null
  name: string | null
  grp: string | null // id группы («b1-mb-mp-1»); у старых записей — имя, см. normalizeGroup
  first_seen: number
  last_seen: number
  visits: number
  last_open: number | null
  starts: number
  can_message: number
  blocked_bot: number
  banned: number
  ban_reason: string | null
  banned_at: number | null
  board_banned_until: number | null
  role: 'student' | 'teacher' | null // NULL — ещё не выбирал (старые пользователи — студенты МБ)
  teacher_id: string | null
  access: Access // будущая оплата: только структура, сейчас всё бесплатно (PAYWALL_ENABLED = false)
  legacy: number // был в базе до онбординга — его не показываем
  onboarded_at: number | null
  starosta_of: string | null // староста этой группы (назначает владелец)
  subgroups: string | null // JSON: выбранные подгруппы
  board_origin: number // «Подслушано»: показывать у псевдонима курс и институт
  review_banned_until: number | null // бан в отзывах о преподавателях
  intro_version: number // какую версию знакомства (истории, тур) уже видел
}

export type Access = 'free_forever' | 'standard'

// Что приложению знать о человеке (POST /seen, /profile)
export type Me = {
  role: 'student' | 'teacher' | null
  group: string | null
  teacher: string | null
  access: Access
  onboarding: boolean // показать онбординг: новый пользователь, ни группы, ни роли
  starosta: string | null // староста этой группы — в «Ещё» есть «Правки группы»
  origin: boolean // «Подслушано»: курс и институт у псевдонима (переключатель в профиле)
  intro: number // какую версию знакомства уже видел (приложение покажет новую один раз)
}

type MeFields = 'role' | 'grp' | 'teacher_id' | 'access' | 'legacy' | 'starosta_of' | 'board_origin' | 'intro_version'

export function meOf(row: Pick<UserRow, MeFields> | null): Me {
  const group = normalizeGroup(row?.grp)
  return {
    role: row?.role ?? null,
    group,
    teacher: row?.teacher_id ?? null,
    access: row?.access ?? 'standard',
    onboarding: !row?.legacy && !group && !row?.role,
    starosta: normalizeGroup(row?.starosta_of),
    origin: Boolean(row?.board_origin),
    intro: row?.intro_version ?? 0,
  }
}

// открытия приложения одним человеком чаще этого считаем за одно
export const VISIT_GAP_MS = 10 * 60_000

// open — открыл приложение, start — /start, message — написал боту в личку,
// inline — пользуется inline-режимом в другом чате (бот ему писать не может)
export type SeenKind = 'open' | 'start' | 'message' | 'inline'

// Отмечает, что человек был. Возвращает бан, группу (её выбирают в приложении) и профиль.
// Группа МБ(МП) 1-1/1-2 — доступ free_forever (навсегда бесплатно; сейчас бесплатно всем).
export async function touchUser(
  db: D1Database,
  profile: Profile,
  kind: SeenKind,
  group: string | null = null,
): Promise<{ banned: boolean; grp: string | null; me: Me }> {
  const now = Date.now()
  const isOpen = kind === 'open' ? 1 : 0
  const isStart = kind === 'start' ? 1 : 0
  const wrote = kind === 'start' || kind === 'message' ? 1 : 0 // писал боту сам — значит, бот может ему ответить
  const grp = normalizeGroup(group)
  // Открытия и inline чаще раза в 10 минут ничего нового не говорят — строку не переписываем (каждая запись —
  // ещё и два индекса, а лимит записи D1 — 100 тыс. строк в сутки). Обновляем, если визит засчитывается, если
  // прошло 10 минут, сменились ник, имя или группа; /start и сообщения — всегда (их счётчики).
  const throttle = kind === 'open' || kind === 'inline' ? 1 : 0
  const [upsert, , current] = await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, username, name, grp, first_seen, last_seen, visits, last_open, starts, can_message, access)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, CASE WHEN ?6 = 1 THEN ?5 END, ?7, ?8,
                 CASE WHEN ?4 IN (?10, ?11) THEN 'free_forever' ELSE 'standard' END)
         ON CONFLICT (id) DO UPDATE SET
           username = excluded.username,
           name = excluded.name,
           grp = COALESCE(excluded.grp, users.grp),
           last_seen = ?5,
           visits = users.visits + CASE WHEN ?6 = 1 AND (users.last_open IS NULL OR ?5 - users.last_open >= ?9) THEN 1 ELSE 0 END,
           last_open = CASE WHEN ?6 = 1 AND (users.last_open IS NULL OR ?5 - users.last_open >= ?9) THEN ?5 ELSE users.last_open END,
           starts = users.starts + ?7,
           can_message = MAX(users.can_message, ?8),
           blocked_bot = CASE WHEN ?8 = 1 THEN 0 ELSE users.blocked_bot END,
           access = CASE WHEN ?4 IN (?10, ?11) THEN 'free_forever' ELSE users.access END
         WHERE ?12 = 0
            OR users.last_seen < ?5 - ?9
            OR (?6 = 1 AND (users.last_open IS NULL OR ?5 - users.last_open >= ?9))
            OR users.username IS NOT excluded.username
            OR users.name IS NOT excluded.name
            OR (excluded.grp IS NOT NULL AND users.grp IS NOT excluded.grp)
            OR (?4 IN (?10, ?11) AND users.access IS NOT 'free_forever')
         RETURNING banned, grp, role, teacher_id, access, legacy, starosta_of, board_origin, intro_version`,
      )
      .bind(profile.id, profile.username, profile.name, grp, now, isOpen, isStart, wrote, VISIT_GAP_MS, MB_IDS[0], MB_IDS[1], throttle),
    // журнал визитов для графиков: /start — всегда, открытие — только если засчитано
    db
      .prepare(
        `INSERT INTO visits (user_id, ts, kind)
         SELECT ?1, ?2, ?3 WHERE ?3 = 'start' OR (?3 = 'open' AND (SELECT last_open FROM users WHERE id = ?1) = ?2)`,
      )
      .bind(profile.id, now, kind),
    // строку не переписали (частое открытие) — берём как есть
    db.prepare('SELECT banned, grp, role, teacher_id, access, legacy, starosta_of, board_origin, intro_version FROM users WHERE id = ?').bind(profile.id),
  ])
  const row = ((upsert.results[0] ?? current.results[0]) as Pick<UserRow, 'banned' | MeFields> | undefined)
  return { banned: Boolean(row?.banned), grp: normalizeGroup(row?.grp), me: meOf(row ?? null) }
}

export const getUser = (db: D1Database, id: number) =>
  db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()

export const findUserByUsername = (db: D1Database, username: string) =>
  db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username.replace(/^@/, '')).first<UserRow>()

export async function allUsers(db: D1Database): Promise<UserRow[]> {
  return (await db.prepare('SELECT * FROM users ORDER BY last_seen DESC').all<UserRow>()).results
}

// @ник, а если его нет — имя со ссылкой на профиль (HTML)
export function userLabel(user: Pick<UserRow, 'id' | 'username' | 'name'>, escape: (s: string) => string): string {
  return user.username
    ? `@${escape(user.username)}`
    : `<a href="tg://user?id=${user.id}">${escape(user.name || `id ${user.id}`)}</a>`
}

// Подгруппы, которые человек выбрал в профиле (только свои пары); null — не выбирал
export async function userSubgroups(db: D1Database, id: number): Promise<number[] | null> {
  const row = await db.prepare('SELECT subgroups FROM users WHERE id = ?').bind(id).first<{ subgroups: string | null }>()
  try {
    const list = row?.subgroups ? (JSON.parse(row.subgroups) as unknown) : null
    return Array.isArray(list) ? list.filter((x): x is number => Number.isSafeInteger(x)) : null
  } catch {
    return null
  }
}
