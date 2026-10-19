// Модерация доски: жалобы приходят владельцу с кнопками, /boardban, снимки холста, чистка старого.
import { resolveTarget, targetLabel } from './admin'
import { isOwner } from './auth'
import { BOARD_IDS, BOARD_TITLES, LEGACY_BOARDS, LIMITS } from './board-config'
import { getUser, userLabel } from './db'
import { answerCallback, sendMessage, tg, tgForm, type TgCallbackQuery } from './telegram'
import { escapeHtml, formatMsk } from './util'

const DAY_MS = 86_400_000
export const FOREVER = 253_402_300_799_000 // 31.12.9999 — «навсегда» для бана на доске

const boardTitle = (board: string) => BOARD_TITLES[board] ?? board

type ReportedMessage = { id: number; board: string; user_id: number; alias: string; text: string }

// Владельцу: текст, доска, настоящий автор и кнопки. Первая жалоба — и когда сообщение скрыто
export async function notifyReport(env: Env, message: ReportedMessage, count: number, hidden: boolean): Promise<void> {
  if (!env.OWNER_ID) return
  const author = await getUser(env.DB, message.user_id)
  const who = author ? `${userLabel(author, escapeHtml)} (id ${author.id})` : `id ${message.user_id}`
  const title = hidden
    ? `🙈 <b>Скрыто после ${count} жалоб</b> — ждёт решения`
    : '🚩 <b>Жалоба на сообщение</b>'
  const text = `${title}
Доска: «${escapeHtml(boardTitle(message.board))}»
Автор: ${who} · ${escapeHtml(message.alias)}
Жалоб: ${count}

<blockquote>${escapeHtml(message.text)}</blockquote>`
  await sendMessage(env, Number(env.OWNER_ID), text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑 Удалить', callback_data: `bd:del:${message.id}` }],
        [{ text: '🔇 Удалить и забанить на доске', callback_data: `bd:ban:${message.id}` }],
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
    return '✅ Удалено, автор забанен на доске'
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
    await sendMessage(env, chatId, `✅ Бан на доске снят: ${targetLabel(user)}`)
    return
  }
  const until = days ? Date.now() + Number(days) * DAY_MS : FOREVER
  await setBoardBan(env, user.id, until)
  const term = days ? `до ${formatMsk(until)} МСК` : 'навсегда'
  await sendMessage(env, chatId, `🔇 Бан на доске ${term}: ${targetLabel(user)}\nЧитать доску может, писать и рисовать — нет.`)
}

export const boardBanTerm = (until: number) => (until >= FOREVER ? 'навсегда' : `до ${formatMsk(until)}`)

// Снимок холста перед очисткой — ещё и владельцу в личку, чтобы архив был под рукой
export async function sendSnapshot(env: Env, board: string, id: number, strokes: number, png: Uint8Array): Promise<void> {
  try {
    const form = new FormData()
    form.append('chat_id', env.OWNER_ID)
    form.append('document', new Blob([png], { type: 'image/png' }), `board-${board}-${id}.png`)
    form.append('caption', `🧹 Холст «${boardTitle(board)}» очищен · штрихов: ${strokes} · снимок №${id}`)
    await tgForm(env, 'sendDocument', form)
  } catch (err) {
    console.error('Не удалось отправить снимок холста:', err)
  }
}

// Раз в час: сообщения старше 30 дней удаляются; стёртые штрихи — через 2 дня;
// на холсте не больше LIMITS.canvasStrokes штрихов (лишние, самые старые, стираются)
export async function cleanupBoard(env: Env, now: number): Promise<number> {
  // и старые доски групп — их записи дочищаем по сроку
  const boards = [...BOARD_IDS, ...LEGACY_BOARDS].map((b) => `'${b}'`).join(', ')
  const old = `SELECT id FROM board_messages WHERE board IN (${boards}) AND created_at < ?1`
  const cutoff = now - LIMITS.keepMessagesDays * DAY_MS
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM board_reactions WHERE message_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM board_reports WHERE message_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM board_messages WHERE board IN (${boards}) AND created_at < ?1`).bind(cutoff),
    env.DB.prepare(`DELETE FROM board_strokes WHERE board IN (${boards}) AND updated_at < ?1 AND deleted = 1`).bind(
      now - 2 * DAY_MS,
    ),
    ...BOARD_IDS.map((board) =>
      env.DB.prepare(
        `UPDATE board_strokes SET deleted = 1, updated_at = ?1 WHERE id IN (
           SELECT id FROM board_strokes WHERE board = ?2 AND deleted = 0 ORDER BY id DESC LIMIT -1 OFFSET ?3)`,
      ).bind(now, board, LIMITS.canvasStrokes),
    ),
  ])
  return 1
}
