// Модерация чата: жалобы приходят владельцу с кнопками, /boardban, чистка старого.
import { resolveTarget, targetLabel } from './admin'
import { isOwner } from './auth'
import { BOARD_IDS, LIMITS } from './board-config'
import { getUser, userLabel } from './db'
import { answerCallback, sendMessage, tg, type TgCallbackQuery } from './telegram'
import { escapeHtml, formatMsk } from './util'

const DAY_MS = 86_400_000
export const FOREVER = 253_402_300_799_000 // 31.12.9999 — «навсегда» для бана в чате

type ReportedMessage = { id: number; board: string; user_id: number; alias: string; text: string }

// Владельцу: текст, настоящий автор и кнопки. Первая жалоба — и когда сообщение скрыто
export async function notifyReport(env: Env, message: ReportedMessage, count: number, hidden: boolean): Promise<void> {
  if (!env.OWNER_ID) return
  const author = await getUser(env.DB, message.user_id)
  const who = author ? `${userLabel(author, escapeHtml)} (id ${author.id})` : `id ${message.user_id}`
  const title = hidden
    ? `🙈 <b>Скрыто после ${count} жалоб</b> — ждёт решения`
    : '🚩 <b>Жалоба на сообщение в чате</b>'
  const text = `${title}
Автор: ${who} · ${escapeHtml(message.alias)}
Жалоб: ${count}

<blockquote>${escapeHtml(message.text)}</blockquote>`
  await sendMessage(env, Number(env.OWNER_ID), text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑 Удалить', callback_data: `bd:del:${message.id}` }],
        [{ text: '🔇 Удалить и забанить в чате', callback_data: `bd:ban:${message.id}` }],
        [{ text: 'Игнорировать', callback_data: `bd:ign:${message.id}` }],
      ],
    },
  })
}

export async function deleteMessage(env: Env, id: number, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE board_messages SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0').bind(now, id),
    env.DB.prepare("UPDATE board_reports SET status = 'deleted' WHERE message_id = ? AND status = 'open'").bind(id),
  ])
}

export async function setBoardBan(env: Env, userId: number, until: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, first_seen, last_seen, board_banned_until) VALUES (?1, ?2, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET board_banned_until = ?3`,
  )
    .bind(userId, Date.now(), until)
    .run()
}

export type ModerationAction = 'del' | 'ban' | 'ign'

// Решение по сообщению — из кнопок под жалобой и из админ-панели. Возвращает итог для показа.
export async function moderate(env: Env, id: number, action: ModerationAction): Promise<string> {
  const message = await env.DB.prepare('SELECT id, user_id, deleted FROM board_messages WHERE id = ?')
    .bind(id)
    .first<{ id: number; user_id: number; deleted: number }>()
  const now = Date.now()
  if (!message) return 'Сообщения уже нет'
  if (action === 'del') {
    await deleteMessage(env, id, now)
    return '✅ Удалено'
  }
  if (action === 'ban') {
    await deleteMessage(env, id, now)
    if (!isOwner(env, message.user_id)) await setBoardBan(env, message.user_id, FOREVER)
    return '✅ Удалено, автор забанен в чате'
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE board_reports SET status = 'ignored' WHERE message_id = ? AND status = 'open'").bind(id),
    env.DB.prepare('UPDATE board_messages SET hidden = 0, updated_at = ? WHERE id = ? AND hidden = 1').bind(now, id),
  ])
  return '👌 Проигнорировано'
}

// Кнопки под жалобой: bd:del | bd:ban | bd:ign : <id сообщения>
export async function onBoardButton(env: Env, query: TgCallbackQuery): Promise<void> {
  if (!isOwner(env, query.from.id)) return void (await answerCallback(env, query.id))
  const [, action, rawId] = (query.data ?? '').split(':')
  if (action !== 'del' && action !== 'ban' && action !== 'ign') return void (await answerCallback(env, query.id))
  const status = await moderate(env, Number(rawId), action)
  if (query.message) {
    await tg(env, 'editMessageReplyMarkup', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: status, callback_data: 'bd:done' }]] },
    })
  }
  await answerCallback(env, query.id, status)
}

// /boardban <id|@ник> [дни]: без дней — навсегда, 0 — снять бан
export async function boardBanCommand(env: Env, chatId: number, args: string): Promise<void> {
  const [target = '', days] = args.trim().split(/\s+/)
  if (!target || (days !== undefined && !/^\d{1,4}$/.test(days))) {
    await sendMessage(
      env,
      chatId,
      'Напишите так: <code>/boardban 123456789 7</code> — на 7 дней, <code>/boardban 123456789</code> — навсегда, <code>/boardban 123456789 0</code> — снять.',
    )
    return
  }
  const user = await resolveTarget(env, target)
  if (!user) return void (await sendMessage(env, chatId, `Не нашёл ${escapeHtml(target)} среди пользователей бота.`))
  if (isOwner(env, user.id)) return void (await sendMessage(env, chatId, 'Себя забанить нельзя 🙂'))

  if (days === '0') {
    await setBoardBan(env, user.id, null)
    await sendMessage(env, chatId, `✅ Бан в чате снят: ${targetLabel(user)}`)
    return
  }
  const until = days ? Date.now() + Number(days) * DAY_MS : FOREVER
  await setBoardBan(env, user.id, until)
  const term = days ? `до ${formatMsk(until)} МСК` : 'навсегда'
  await sendMessage(env, chatId, `🔇 Бан в чате ${term}: ${targetLabel(user)}\nЧитать может, писать — нет.`)
}

export const boardBanTerm = (until: number) => (until >= FOREVER ? 'навсегда' : `до ${formatMsk(until)}`)

// Раз в час: сообщения старше 30 дней удаляются вместе с реакциями и жалобами
export async function cleanupBoard(env: Env, now: number): Promise<number> {
  const boards = BOARD_IDS.map((b) => `'${b}'`).join(', ')
  const old = `SELECT id FROM board_messages WHERE board IN (${boards}) AND created_at < ?1`
  const cutoff = now - LIMITS.keepMessagesDays * DAY_MS
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM board_reactions WHERE message_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM board_reports WHERE message_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM board_messages WHERE board IN (${boards}) AND created_at < ?1`).bind(cutoff),
  ])
  return 1
}
