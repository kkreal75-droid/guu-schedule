// Пользователи в D1 (схема — migrations/0001_init.sql).
import type { Profile } from './auth'

export type UserRow = {
  id: number
  username: string | null
  name: string | null
  grp: string | null
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
}

// открытия приложения одним человеком чаще этого считаем за одно
export const VISIT_GAP_MS = 10 * 60_000

export const GROUPS = ['МБ(МП) 1-1', 'МБ(МП) 1-2'] as const
export const shortGroup = (group: string) => group.replace('МБ(МП) ', '') // «1-1»

export type SeenKind = 'open' | 'start' | 'message'

// Отмечает, что человек был: открыл приложение, нажал /start или просто написал боту.
// Возвращает актуальное состояние бана.
export async function touchUser(
  db: D1Database,
  profile: Profile,
  kind: SeenKind,
  group: string | null = null,
): Promise<{ banned: boolean }> {
  const now = Date.now()
  const isOpen = kind === 'open' ? 1 : 0
  const isStart = kind === 'start' ? 1 : 0
  const wrote = kind === 'open' ? 0 : 1 // писал боту сам — значит, бот может ему ответить
  const grp = group && (GROUPS as readonly string[]).includes(group) ? group : null
  const [upsert] = await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, username, name, grp, first_seen, last_seen, visits, last_open, starts, can_message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, CASE WHEN ?6 = 1 THEN ?5 END, ?7, ?8)
         ON CONFLICT (id) DO UPDATE SET
           username = excluded.username,
           name = excluded.name,
           grp = COALESCE(excluded.grp, users.grp),
           last_seen = ?5,
           visits = users.visits + CASE WHEN ?6 = 1 AND (users.last_open IS NULL OR ?5 - users.last_open >= ?9) THEN 1 ELSE 0 END,
           last_open = CASE WHEN ?6 = 1 AND (users.last_open IS NULL OR ?5 - users.last_open >= ?9) THEN ?5 ELSE users.last_open END,
           starts = users.starts + ?7,
           can_message = MAX(users.can_message, ?8),
           blocked_bot = CASE WHEN ?8 = 1 THEN 0 ELSE users.blocked_bot END
         RETURNING banned`,
      )
      .bind(profile.id, profile.username, profile.name, grp, now, isOpen, isStart, wrote, VISIT_GAP_MS),
    // журнал визитов для графиков: /start — всегда, открытие — только если засчитано
    db
      .prepare(
        `INSERT INTO visits (user_id, ts, kind)
         SELECT ?1, ?2, ?3 WHERE ?3 = 'start' OR (?3 = 'open' AND (SELECT last_open FROM users WHERE id = ?1) = ?2)`,
      )
      .bind(profile.id, now, kind),
  ])
  const row = (upsert.results as { banned: number }[])[0]
  return { banned: Boolean(row?.banned) }
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
