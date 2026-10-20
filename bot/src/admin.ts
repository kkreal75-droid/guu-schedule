// Админские команды бота про пользователей: /stats, /export, /ban, /unban, /bans.
import { isOwner } from './auth'
import { boardBanTerm } from './board-moderation'
import { mbName, normalizeGroup } from '../../shared/groups'
import { allUsers, findUserByUsername, getUser, userLabel, type UserRow } from './db'
import { sendMessage, tgForm } from './telegram'
import { csv, escapeHtml, formatMsk, formatMskFull } from './util'

const DAY_MS = 86_400_000

// ---------- /stats ----------

export async function sendStats(env: Env, chatId: number): Promise<void> {
  const users = await allUsers(env.DB) // уже по убыванию последнего захода
  const now = Date.now()
  const count = (pred: (u: UserRow) => boolean) => users.filter(pred).length
  const totalOpens = users.reduce((sum, u) => sum + u.visits, 0)
  const since = users.length ? Math.min(...users.map((u) => u.first_seen)) : now

  const header = `📊 <b>Статистика бота</b>

👥 Пользователей: <b>${users.length}</b>
📱 Открытий приложения: <b>${totalOpens}</b> (людей: <b>${count((u) => u.visits > 0)}</b>)
▶️ Нажимали /start: <b>${count((u) => u.starts > 0)}</b>
🆕 Новых за 7 дней: <b>${count((u) => u.first_seen >= now - 7 * DAY_MS)}</b>
🔥 Были за сутки: <b>${count((u) => u.last_seen >= now - DAY_MS)}</b>`
  const footer = `\n\n<i>Данные с ${formatMsk(since)} МСК: раньше бот ничего не записывал. Открытия одного человека в течение 10 минут считаются за одно.</i>`

  // список «кто заходил»; Telegram не примет сообщение длиннее 4096 символов
  const lines: string[] = []
  let length = header.length + footer.length + 40
  for (const [i, user] of users.entries()) {
    const activity = [user.visits ? `📱 ${user.visits}` : null, user.starts ? `▶️ ${user.starts}` : null, formatMsk(user.last_seen)]
      .filter(Boolean)
      .join(' · ')
    const marks = [isOwner(env, user.id) ? ' (вы)' : '', user.banned ? ' 🚫' : ''].join('')
    const line = `${i + 1}. ${userLabel(user, escapeHtml)}${marks} — ${activity}`
    if (length + line.length + 1 > 4000) {
      lines.push(`…и ещё ${users.length - i}`)
      break
    }
    lines.push(line)
    length += line.length + 1
  }
  const list = lines.length ? `\n\n<b>Кто заходил</b> (последние сверху):\n${lines.join('\n')}` : ''
  await sendMessage(env, chatId, header + list + footer)
}

// ---------- /export ----------

export async function exportUsers(env: Env, chatId: number): Promise<void> {
  const users = await allUsers(env.DB)
  const now = Date.now()
  const yesNo = (flag: unknown) => (flag ? 'да' : 'нет')
  const rows = [
    ['id', 'имя', 'username', 'группа', 'первый визит', 'последний визит', 'визитов', 'blocked_bot', 'banned', 'board_banned'],
    ...users.map((u) => [
      u.id,
      u.name,
      u.username ? `@${u.username}` : '',
      u.grp ? (mbName(normalizeGroup(u.grp) ?? '') ?? u.grp) : '',
      formatMskFull(u.first_seen),
      formatMskFull(u.last_seen),
      u.visits,
      yesNo(u.blocked_bot),
      yesNo(u.banned),
      yesNo(u.board_banned_until && u.board_banned_until > now),
    ]),
  ]
  const date = formatMskFull(now).slice(0, 10).replace(/\./g, '-') // ДД-ММ-ГГГГ
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('document', new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }), `users_${date}.csv`)
  form.append('caption', `👥 Пользователей: ${users.length}`)
  await tgForm(env, 'sendDocument', form)
}

// ---------- /ban, /unban, /bans ----------

// «123456» или «@nick» → пользователь; по id можно забанить и того, кого бот ещё не видел
export async function resolveTarget(env: Env, target: string): Promise<UserRow | { id: number; unknown: true } | null> {
  if (/^\d+$/.test(target)) return (await getUser(env.DB, Number(target))) ?? { id: Number(target), unknown: true }
  if (/^@?\w{3,}$/.test(target)) return findUserByUsername(env.DB, target)
  return null
}

export const targetLabel = (user: UserRow | { id: number; unknown: true }) =>
  'unknown' in user ? `id ${user.id}` : `${userLabel(user, escapeHtml)} (id ${user.id})`

export async function banCommand(env: Env, chatId: number, args: string): Promise<void> {
  const [target = '', ...reasonParts] = args.trim().split(/\s+/)
  const reason = reasonParts.join(' ').slice(0, 200) || null
  if (!target) {
    await sendMessage(env, chatId, 'Напишите так: <code>/ban 123456789 причина</code> или <code>/ban @username причина</code>')
    return
  }
  const user = await resolveTarget(env, target)
  if (!user) {
    await sendMessage(env, chatId, `Не нашёл ${escapeHtml(target)} среди пользователей бота. Можно банить по id.`)
    return
  }
  if (isOwner(env, user.id)) return void (await sendMessage(env, chatId, 'Себя забанить нельзя 🙂'))

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, first_seen, last_seen, banned, ban_reason, banned_at) VALUES (?1, ?2, ?2, 1, ?3, ?2)
     ON CONFLICT (id) DO UPDATE SET banned = 1, ban_reason = ?3, banned_at = ?2`,
  )
    .bind(user.id, now, reason)
    .run()
  await sendMessage(env, chatId, `🚫 Забанен: ${targetLabel(user)}${reason ? `\nПричина: ${escapeHtml(reason)}` : ''}`)
}

export async function unbanCommand(env: Env, chatId: number, args: string): Promise<void> {
  const target = args.trim().split(/\s+/)[0] ?? ''
  if (!target) return void (await sendMessage(env, chatId, 'Напишите так: <code>/unban 123456789</code>'))
  const user = await resolveTarget(env, target)
  if (!user || 'unknown' in user || !user.banned) {
    await sendMessage(env, chatId, `${escapeHtml(target)} не в бане.`)
    return
  }
  await env.DB.prepare('UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?').bind(user.id).run()
  await sendMessage(env, chatId, `✅ Разбанен: ${targetLabel(user)}`)
}

export async function listBans(env: Env, chatId: number): Promise<void> {
  const [banned, boardBanned] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM users WHERE banned = 1 ORDER BY banned_at DESC'),
    env.DB.prepare('SELECT * FROM users WHERE board_banned_until > ? ORDER BY board_banned_until DESC').bind(Date.now()),
  ])
  const bans = banned.results as UserRow[]
  const boardBans = boardBanned.results as UserRow[]
  if (!bans.length && !boardBans.length) return void (await sendMessage(env, chatId, 'Банов нет.'))
  const parts: string[] = []
  if (bans.length) {
    const lines = bans.map(
      (u, i) =>
        `${i + 1}. ${targetLabel(u)} · ${u.banned_at ? formatMsk(u.banned_at) : '—'}${u.ban_reason ? `\n    ${escapeHtml(u.ban_reason)}` : ''}`,
    )
    parts.push(`🚫 <b>Забанены (${bans.length})</b>\n\n${lines.join('\n')}`)
  }
  if (boardBans.length) {
    const lines = boardBans.map((u, i) => `${i + 1}. ${targetLabel(u)} · ${boardBanTerm(u.board_banned_until!)}`)
    parts.push(`🔇 <b>Бан на доске (${boardBans.length})</b>\n\n${lines.join('\n')}`)
  }
  await sendMessage(env, chatId, parts.join('\n\n'))
}
