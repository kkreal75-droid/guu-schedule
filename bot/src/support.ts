// «Другое → Написать в поддержку» (этап 7.5): POST /support {initData, text} → владельцу в бот с кнопкой
// «Ответить» (sp:reply:<№>). Нажал — бот просит ответ (force_reply); ответ на это сообщение уходит автору.
// Ответ можно и поставить в очередь (support_messages.reply_text, migrations/0021) — cron отправит его так же.
import { json, readApi } from './api'
import { isOwner } from './auth'
import { cleanText } from './text-filter'
import { getUser, userLabel } from './db'
import { answerCallback, isUnreachable, sendMessage, type TgCallbackQuery, type TgMessage } from './telegram'
import { escapeHtml } from './util'

const DAY_MS = 86_400_000
const PER_DAY = 5
const PROMPT = '✍️ Ответ на обращение №'
const answerText = (text: string) => `💬 <b>Ответ на твоё обращение</b>\n\n${escapeHtml(text)}`

export async function handleSupport(env: Env, request: Request): Promise<Response> {
  const req = await readApi<{ text?: unknown }>(env, request, { write: true })
  if (req instanceof Response) return req
  const text = cleanText(req.body.text)
  if ([...text].length < 3) return json({ ok: false, error: 'Напиши пару слов' }, 400)
  if ([...text].length > 2000) return json({ ok: false, error: 'Слишком длинно — до 2000 символов' }, 400)
  const now = Date.now()
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND created_at > ?')
    .bind(req.profile.id, now - DAY_MS)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= PER_DAY && !req.admin) return json({ ok: false, error: 'На сегодня хватит — напиши завтра' }, 429)
  const row = await env.DB.prepare('INSERT INTO support_messages (user_id, text, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(req.profile.id, text, now)
    .first<{ id: number }>()
  const user = req.user ?? (await getUser(env.DB, req.profile.id))
  const who = user ? userLabel(user, escapeHtml) : escapeHtml(req.profile.name ?? `id ${req.profile.id}`)
  await sendMessage(
    env,
    Number(env.OWNER_ID),
    `🆘 <b>Обращение №${row!.id}</b>\nОт: ${who} (id ${req.profile.id})${user?.grp ? ` · ${escapeHtml(user.grp)}` : ''}\n\n<blockquote>${escapeHtml(text)}</blockquote>`,
    { reply_markup: { inline_keyboard: [[{ text: '↩️ Ответить', callback_data: `sp:reply:${row!.id}` }]] } },
  )
  return json({ ok: true, id: row!.id })
}

// Кнопка «Ответить» под обращением — бот просит текст ответа
export async function onSupportButton(env: Env, query: TgCallbackQuery): Promise<void> {
  if (!isOwner(env, query.from.id)) return void (await answerCallback(env, query.id))
  const id = Number((query.data ?? '').split(':')[2])
  await answerCallback(env, query.id)
  if (!Number.isSafeInteger(id)) return
  await sendMessage(env, query.from.id, `${PROMPT}${id} — напишите текст ответом на это сообщение.`, {
    reply_markup: { force_reply: true, input_field_placeholder: 'Ответ пользователю' },
  })
}

// Ответ владельца на «✍️ Ответ на обращение №N» — автору. true — сообщение обработано
export async function handleSupportReply(env: Env, message: TgMessage & { reply_to_message?: TgMessage }): Promise<boolean> {
  const prompt = message.reply_to_message?.text ?? ''
  if (!message.from || !isOwner(env, message.from.id) || !prompt.startsWith(PROMPT)) return false
  const id = Number(prompt.slice(PROMPT.length).match(/^\d+/)?.[0])
  const text = (message.text ?? '').trim()
  const row = await env.DB.prepare('SELECT user_id FROM support_messages WHERE id = ?').bind(id).first<{ user_id: number }>()
  if (!row || !text) {
    await sendMessage(env, message.chat.id, 'Не нашёл обращение или ответ пустой.')
    return true
  }
  try {
    await sendMessage(env, row.user_id, answerText(text))
    await env.DB.prepare('UPDATE support_messages SET answered_at = ? WHERE id = ?').bind(Date.now(), id).run()
    await sendMessage(env, message.chat.id, `✅ Ответ на обращение №${id} отправлен.`)
  } catch (err) {
    if (!isUnreachable(err)) throw err
    await sendMessage(env, message.chat.id, `❌ Не доставлено: человек не запускал бота или заблокировал его. Обращение №${id}.`)
  }
  return true
}

// cron: ответы из очереди (reply_text) — автору, владельцу — отметка, что ушло. Возвращает число подзапросов
export async function sendQueuedReplies(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT id, user_id, reply_text FROM support_messages WHERE reply_text IS NOT NULL AND answered_at IS NULL ORDER BY id LIMIT 3',
  ).all<{ id: number; user_id: number; reply_text: string }>()
  let used = 1
  for (const row of results) {
    const text = row.reply_text.trim()
    let delivered = true
    try {
      if (text) await sendMessage(env, row.user_id, answerText(text))
    } catch (err) {
      if (!isUnreachable(err)) throw err
      delivered = false
    }
    const sent = delivered && Boolean(text)
    // недоставленное не повторяем: снимаем из очереди, владельцу — почему
    await (sent
      ? env.DB.prepare('UPDATE support_messages SET answered_at = ? WHERE id = ?').bind(Date.now(), row.id)
      : env.DB.prepare('UPDATE support_messages SET reply_text = NULL WHERE id = ?').bind(row.id)
    ).run()
    await sendMessage(
      env,
      Number(env.OWNER_ID),
      sent
        ? `✅ Ответ на обращение №${row.id} отправлен (из очереди).`
        : `❌ Ответ на обращение №${row.id} не доставлен: ${text ? 'человек не запускал бота или заблокировал его' : 'пустой текст'}.`,
    )
    used += 3
  }
  return used
}
