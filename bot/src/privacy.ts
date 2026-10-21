// /deleteme — удалить свои данные (только в личке, с подтверждением кнопкой).
// Удаляется: профиль (группа, роль, имя, ник, подгруппы, староста), подписка на календарь, визиты, скрытые пары,
// голоса «полезно», обращения в поддержку, очередь рассылок. Отзывы и жалобы (и последние сообщения бывшего
// анонимного чата, пока их не стёр cron) остаются, но обезличиваются: вместо id — случайный отрицательный номер (связь с человеком теряется, в том числе для
// владельца). Если у человека бан — остаётся только строка с баном (иначе /deleteme снимал бы бан).
// Заметки хранятся в облаке Telegram у самого пользователя — бот их не видит и удалить не может.
import { isLang } from '../../shared/i18n-core'
import { langOf, tr, type Lang } from './i18n'
import { sendMessage, tg, type TgCallbackQuery, type TgMessage } from './telegram'

const ASK = `🗑 <b>Удалить твои данные?</b>

Удалятся: профиль (группа, роль, имя и ник), подписка на календарь, подгруппы, скрытые пары, история визитов, обращения в поддержку.
Отзывы о преподавателях останутся, но без связи с тобой — даже для администратора.

Заметки к парам хранятся в облаке Telegram в твоём аккаунте — бот их не видит; удалить их можно в приложении.`

// язык — в кнопке (dm:yes:en): после удаления спросить его у базы будет не у кого
export async function deleteMeCommand(env: Env, message: TgMessage, lang: Lang = 'ru'): Promise<void> {
  await sendMessage(env, message.chat.id, tr(lang, ASK), {
    reply_markup: {
      inline_keyboard: [[{ text: tr(lang, 'Да, удалить'), callback_data: `dm:yes:${lang}` }, { text: tr(lang, 'Отмена'), callback_data: `dm:no:${lang}` }]],
    },
  })
}

const edit = (env: Env, query: TgCallbackQuery, text: string) =>
  tg(env, 'editMessageText', { chat_id: query.message!.chat.id, message_id: query.message!.message_id, text, parse_mode: 'HTML' })

// случайный отрицательный id: по нему не восстановить настоящий (в отличие от, например, −id)
function anonId(): number {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2))
  return -(((hi & 0x1fffff) * 2 ** 32 + lo) + 1)
}

export async function onDeleteMeButton(env: Env, query: TgCallbackQuery): Promise<void> {
  const chat = query.message?.chat
  // только в своей личке — чужое удалить нельзя
  if (!chat || chat.type !== 'private' || chat.id !== query.from.id) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: query.id })
    return
  }
  await tg(env, 'answerCallbackQuery', { callback_query_id: query.id })
  const [, answer, code] = (query.data ?? '').split(':')
  const lang = isLang(code) ? code : langOf(null, query.from.language_code)
  if (answer !== 'yes') return void (await edit(env, query, tr(lang, 'Хорошо, ничего не удаляю.')))

  const id = query.from.id
  const anon = anonId()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM visits WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM support_messages WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM broadcast_queue WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM board_reactions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM review_votes WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM hidden_lessons WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM board_members WHERE user_id = ?').bind(id),
    // бывший анонимный чат: сообщения доживают 30 дней (journal.ts) — тоже без автора
    env.DB.prepare('UPDATE board_aliases SET user_id = ? WHERE user_id = ?').bind(anon, id),
    env.DB.prepare('UPDATE board_messages SET user_id = ?, origin = NULL, updated_at = ? WHERE user_id = ?').bind(anon, now, id),
    env.DB.prepare('UPDATE board_reports SET reporter_id = ? WHERE reporter_id = ?').bind(anon, id),
    env.DB.prepare('UPDATE teacher_reviews SET user_id = ?, grp = NULL WHERE user_id = ?').bind(anon, id),
    env.DB.prepare('UPDATE review_reports SET reporter_id = ? WHERE reporter_id = ?').bind(anon, id),
    // правки старосты остаются в расписании группы, но без автора (0 — «староста», не владелец)
    env.DB.prepare('UPDATE schedule_edits SET author_id = 0 WHERE author_id = ?').bind(id),
    env.DB.prepare('UPDATE subgroups SET created_by = 0 WHERE created_by = ?').bind(id),
    env.DB.prepare('UPDATE lesson_tags SET created_by = 0 WHERE created_by = ?').bind(id),
    // бан — оставляем только его, без имени и группы; без бана — строки нет совсем
    env.DB.prepare(
      `UPDATE users SET username = NULL, name = NULL, grp = NULL, role = NULL, teacher_id = NULL, starosta_of = NULL,
         subgroups = NULL, board_origin = 0, can_message = 0, visits = 0, starts = 0, last_open = NULL,
         onboarded_at = NULL, intro_version = 0
       WHERE id = ?1`,
    ).bind(id),
    env.DB.prepare(
      `DELETE FROM users WHERE id = ?1 AND banned = 0 AND COALESCE(review_banned_until, 0) < ?2`,
    ).bind(id, now),
  ])
  await edit(env, query, tr(lang, '✅ Готово: твои данные удалены. Отзывы остались без связи с тобой.'))
}
