// Рассылки: /broadcast → предпросмотр с кнопками аудитории → отправка пачками → отчёт.
// На бесплатном тарифе один вызов воркера — максимум 50 подзапросов (Telegram, D1, KV),
// поэтому за раз отправляем BATCH сообщений, остальное досылает cron раз в минуту.
import { isOwner } from './auth'
import { MB_GROUPS, describeAudience, matchGroups, type AudienceFilter } from '../../shared/groups'
import { loadGroupsIndex } from './schedule'
import { TelegramError, answerCallback, sendMessage, tg, tgForm, type Keyboard, type TgCallbackQuery, type TgMessage } from './telegram'
import { entitiesToHtml, escapeHtml, formatMsk, hasFormatting, stripCommand } from './util'

export const BATCH = 30
const PAUSE_MS = 50
const CAPTION_LIMIT = 1024
const TEXT_LIMIT = 4096

// Кому: всем, МБ 1-1 / 1-2 (кнопки под /broadcast) или по фильтру из админ-панели — уровень, форма,
// курс, институт, группа. В broadcasts.audience фильтр хранится JSON-ом {"t": подпись, "f": фильтр}.
export type Audience = 'all' | '1-1' | '1-2' | AudienceFilter
const LEGACY_TITLE: Record<string, string> = { all: 'всем', '1-1': 'МБ(МП) 1-1', '1-2': 'МБ(МП) 1-2' }
export const audienceTitle = (stored: string | null) => {
  if (!stored) return '—'
  if (!stored.startsWith('{')) return LEGACY_TITLE[stored] ?? stored
  try {
    return (JSON.parse(stored) as { t?: string }).t ?? 'по фильтру'
  } catch {
    return 'по фильтру'
  }
}

// Группы аудитории; null — все пользователи
async function audienceGroups(env: Env, audience: Audience): Promise<{ groups: string[] | null; stored: string }> {
  if (audience === 'all') return { groups: null, stored: 'all' }
  if (audience === '1-1' || audience === '1-2') {
    return { groups: [MB_GROUPS.find((g) => g.short === audience)!.id], stored: audience }
  }
  const index = await loadGroupsIndex(env)
  const filter: AudienceFilter = {
    level: audience.level,
    form: audience.form,
    course: audience.course,
    institute: audience.institute,
    group: audience.group,
  }
  return { groups: matchGroups(index.groups, filter), stored: JSON.stringify({ t: describeAudience(filter, index.groups), f: filter }) }
}

// Сколько получателей у фильтра (админ-панель показывает до отправки)
export async function audienceCount(env: Env, audience: Audience): Promise<number> {
  const { groups } = await audienceGroups(env, audience)
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE ${RECIPIENTS} AND ${BY_GROUPS('?1')}`,
  )
    .bind(groups ? JSON.stringify(groups) : null)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export type BroadcastRow = {
  id: number
  created_at: number
  text: string
  photo: string | null
  audience: string | null // 'all' | '1-1' | '1-2' | JSON {t, f}
  status: 'draft' | 'sending' | 'done' | 'cancelled'
  preview_chat: number | null
  preview_message: number | null
  total: number
  delivered: number
  blocked: number
  failed: number
  finished_at: number | null
}

// Кому можно слать: писали боту, не заблокировали его, не забанены
const RECIPIENTS = 'can_message = 1 AND blocked_bot = 0 AND banned = 0'
// по группам (param — JSON-список id или NULL = всем); преподавателю с прежней группой студента —
// рассылка по группам не нужна
const BY_GROUPS = (param: string) =>
  `(${param} IS NULL OR (grp IN (SELECT value FROM json_each(${param})) AND COALESCE(role, '') != 'teacher'))`
type ButtonAudience = 'all' | '1-1' | '1-2'

export async function audienceCounts(db: D1Database): Promise<Record<ButtonAudience, number>> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(grp = ?1), 0) AS g11,
              COALESCE(SUM(grp = ?2), 0) AS g12
       FROM users WHERE ${RECIPIENTS}`,
    )
    .bind(MB_GROUPS[0].id, MB_GROUPS[1].id)
    .first<{ total: number; g11: number; g12: number }>()
  return { all: row?.total ?? 0, '1-1': row?.g11 ?? 0, '1-2': row?.g12 ?? 0 }
}

const audienceKeyboard = (id: number, counts: Record<ButtonAudience, number>): Keyboard => ({
  inline_keyboard: [
    [{ text: `Всем (${counts.all})`, callback_data: `bc:${id}:all` }],
    [
      { text: `1-1 (${counts['1-1']})`, callback_data: `bc:${id}:1-1` },
      { text: `1-2 (${counts['1-2']})`, callback_data: `bc:${id}:1-2` },
    ],
    [{ text: 'Отмена', callback_data: `bc:${id}:cancel` }],
  ],
})

// Отправка одного сообщения рассылки (и предпросмотра — тем же способом)
function deliver(env: Env, chatId: number, row: Pick<BroadcastRow, 'text' | 'photo'>, extra: object = {}) {
  return row.photo
    ? tg<TgMessage>(env, 'sendPhoto', { chat_id: chatId, photo: row.photo, caption: row.text, parse_mode: 'HTML', ...extra })
    : tg<TgMessage>(env, 'sendMessage', { chat_id: chatId, text: row.text, parse_mode: 'HTML', ...extra })
}

// /broadcast <текст> или фото с подписью «/broadcast <текст>»
export async function startBroadcast(env: Env, message: TgMessage): Promise<void> {
  const chatId = message.chat.id
  const source = message.photo
    ? stripCommand(message.caption ?? '', message.caption_entities)
    : stripCommand(message.text ?? '', message.entities)
  // выделили текст средствами Telegram — переводим в HTML; иначе считаем, что теги написаны руками
  const html = (hasFormatting(source.entities) ? entitiesToHtml(source.text, source.entities) : source.text).trim()
  const photo = message.photo?.at(-1)?.file_id ?? null

  if (!html && !photo) {
    await sendMessage(
      env,
      chatId,
      'Напишите так: <code>/broadcast текст</code>\nМожно с HTML (<code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, ссылки) или с фото — отправьте фото с подписью «/broadcast текст».',
    )
    return
  }
  if (html.length > (photo ? CAPTION_LIMIT : TEXT_LIMIT)) {
    await sendMessage(env, chatId, `Слишком длинно: ${photo ? 'подпись к фото' : 'сообщение'} — до ${photo ? CAPTION_LIMIT : TEXT_LIMIT} символов.`)
    return
  }

  const draft = await env.DB.prepare(
    `INSERT INTO broadcasts (created_at, text, photo, status) VALUES (?, ?, ?, 'draft') RETURNING id`,
  )
    .bind(Date.now(), html, photo)
    .first<{ id: number }>()
  const id = draft!.id
  const counts = await audienceCounts(env.DB)

  await sendMessage(env, chatId, `📣 <b>Предпросмотр рассылки #${id}</b> — так её увидят. Кому отправить?`)
  try {
    const preview = await deliver(env, chatId, { text: html, photo }, { reply_markup: audienceKeyboard(id, counts) })
    await env.DB.prepare('UPDATE broadcasts SET preview_chat = ?, preview_message = ? WHERE id = ?')
      .bind(chatId, preview.message_id, id)
      .run()
  } catch (err) {
    // чаще всего — незакрытый или неизвестный HTML-тег
    await env.DB.prepare(`UPDATE broadcasts SET status = 'cancelled' WHERE id = ?`).bind(id).run()
    if (err instanceof TelegramError && err.code === 400) {
      await sendMessage(env, chatId, `Telegram не принял сообщение: <code>${escapeHtml(err.description)}</code>\nПроверьте HTML-теги и отправьте /broadcast заново.`)
      return
    }
    throw err
  }
}

// Кнопки под предпросмотром: «Всем», «1-1», «1-2», «Отмена»
export async function onBroadcastButton(env: Env, ctx: ExecutionContext, query: TgCallbackQuery): Promise<void> {
  if (!isOwner(env, query.from.id)) return void (await answerCallback(env, query.id))
  const [, idText, choice] = (query.data ?? '').split(':')
  const id = Number(idText)
  const row = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first<BroadcastRow>()
  if (!row || row.status !== 'draft') {
    await answerCallback(env, query.id, row ? 'Эта рассылка уже запущена или отменена' : 'Рассылка не найдена')
    return
  }
  const removeButtons = () =>
    row.preview_chat && row.preview_message
      ? tg(env, 'editMessageReplyMarkup', { chat_id: row.preview_chat, message_id: row.preview_message, reply_markup: { inline_keyboard: [] } }).catch(() => {})
      : Promise.resolve()

  if (choice === 'cancel') {
    await env.DB.prepare(`UPDATE broadcasts SET status = 'cancelled' WHERE id = ?`).bind(id).run()
    await Promise.all([removeButtons(), answerCallback(env, query.id, 'Рассылка отменена')])
    return
  }
  if (!(choice in LEGACY_TITLE)) return void (await answerCallback(env, query.id))
  const audience = choice as ButtonAudience
  const total = await enqueue(env, id, audience)
  await Promise.all([removeButtons(), answerCallback(env, query.id, `Отправляю: ${total}`)])
  await sendMessage(env, query.from.id, `⏳ Рассылка #${id} пошла: ${LEGACY_TITLE[audience]}, получателей — ${total}. Пришлю отчёт.`)
  // первая пачка — сразу, остальное досылает cron
  ctx.waitUntil(drainBroadcasts(env))
}

// Очередь доставки — одним запросом; бан/блокировку проверяем ещё раз перед отправкой.
// skip — кому уже отправлено (копия владельцу из админ-панели).
async function enqueue(env: Env, id: number, audience: Audience, skip: number | null = null): Promise<number> {
  const { groups, stored } = await audienceGroups(env, audience)
  const [, , counted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO broadcast_queue (broadcast_id, user_id)
       SELECT ?1, id FROM users WHERE ${RECIPIENTS}
         AND ${BY_GROUPS('?2')} AND (?3 IS NULL OR id != ?3)`,
    ).bind(id, groups ? JSON.stringify(groups) : null, skip),
    env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending', audience = ?2,
         total = (SELECT COUNT(*) FROM broadcast_queue WHERE broadcast_id = ?1)
       WHERE id = ?1`,
    ).bind(id, stored),
    env.DB.prepare('SELECT total FROM broadcasts WHERE id = ?').bind(id),
  ])
  return (counted.results as { total: number }[])[0]?.total ?? 0
}

// ---------- из админ-панели ----------

export type PanelBroadcast = { text: string; photo: Uint8Array | null; audience: Audience | null }

// Сначала — копия владельцу: так Telegram проверит HTML, а фото загрузится один раз (file_id).
// audience null — только предпросмотр. Ошибка HTML — { error }.
export async function panelBroadcast(
  env: Env,
  ctx: ExecutionContext,
  { text, photo, audience }: PanelBroadcast,
): Promise<{ id?: number; total?: number; error?: string }> {
  const owner = Number(env.OWNER_ID)
  const html = text.trim()
  if (!html && !photo) return { error: 'Напишите текст или добавьте фото' }
  if (html.length > (photo ? CAPTION_LIMIT : TEXT_LIMIT)) {
    return { error: `Слишком длинно: ${photo ? 'подпись к фото' : 'сообщение'} — до ${photo ? CAPTION_LIMIT : TEXT_LIMIT} символов` }
  }
  let fileId: string | null = null
  try {
    if (photo) {
      const form = new FormData()
      form.append('chat_id', String(owner))
      form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'broadcast.jpg')
      if (html) {
        form.append('caption', html)
        form.append('parse_mode', 'HTML')
      }
      const sent = await tgForm<TgMessage>(env, 'sendPhoto', form)
      fileId = sent.photo?.at(-1)?.file_id ?? null
    } else {
      await deliver(env, owner, { text: html, photo: null })
    }
  } catch (err) {
    if (err instanceof TelegramError && err.code === 400) return { error: `Telegram не принял сообщение: ${err.description}` }
    throw err
  }
  if (!audience) return {}

  const row = await env.DB.prepare(
    `INSERT INTO broadcasts (created_at, text, photo, status) VALUES (?, ?, ?, 'draft') RETURNING id`,
  )
    .bind(Date.now(), html, fileId)
    .first<{ id: number }>()
  const id = row!.id
  const total = await enqueue(env, id, audience, owner)
  ctx.waitUntil(drainBroadcasts(env))
  return { id, total }
}

export async function broadcastHistory(env: Env, limit = 20): Promise<BroadcastRow[]> {
  return (await env.DB.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT ?').bind(limit).all<BroadcastRow>()).results
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Досылает очередь: до batch сообщений за вызов. Возвращает, сколько отправлено.
export async function drainBroadcasts(env: Env, batch = BATCH): Promise<number> {
  const [, picked] = await env.DB.batch([
    // забанили, пока рассылка стояла в очереди, — не шлём
    env.DB.prepare(
      `UPDATE broadcast_queue SET status = 'failed', error = 'забанен'
       WHERE status = 'pending' AND user_id IN (SELECT id FROM users WHERE banned = 1)`,
    ),
    env.DB.prepare(
      `SELECT q.broadcast_id, q.user_id, b.text, b.photo
       FROM broadcast_queue q JOIN broadcasts b ON b.id = q.broadcast_id
       WHERE q.status = 'pending' AND b.status = 'sending'
       ORDER BY q.broadcast_id LIMIT ?`,
    ).bind(batch),
  ])
  const pending = picked.results as { broadcast_id: number; user_id: number; text: string; photo: string | null }[]
  if (!pending.length) {
    await finishCompleted(env) // вдруг вся очередь отпала из-за банов
    return 0
  }

  const updates: D1PreparedStatement[] = []
  const touched = new Set<number>()
  let sent = 0
  for (const item of pending) {
    if (sent > 0) await sleep(PAUSE_MS)
    let status = 'delivered'
    let error: string | null = null
    try {
      await deliver(env, item.user_id, item)
    } catch (err) {
      if (err instanceof TelegramError && err.code === 429) break // Telegram просит подождать — продолжит cron
      error = err instanceof Error ? err.message.slice(0, 300) : String(err)
      if (err instanceof TelegramError && err.code === 403) {
        status = 'blocked'
        updates.push(env.DB.prepare('UPDATE users SET blocked_bot = 1 WHERE id = ?').bind(item.user_id))
      } else {
        status = 'failed'
      }
    }
    sent++
    touched.add(item.broadcast_id)
    updates.push(
      env.DB.prepare('UPDATE broadcast_queue SET status = ?, error = ? WHERE broadcast_id = ? AND user_id = ?').bind(
        status,
        error,
        item.broadcast_id,
        item.user_id,
      ),
    )
  }
  for (const id of touched) {
    updates.push(
      env.DB.prepare(
        `UPDATE broadcasts SET
           delivered = (SELECT COUNT(*) FROM broadcast_queue WHERE broadcast_id = ?1 AND status = 'delivered'),
           blocked = (SELECT COUNT(*) FROM broadcast_queue WHERE broadcast_id = ?1 AND status = 'blocked'),
           failed = (SELECT COUNT(*) FROM broadcast_queue WHERE broadcast_id = ?1 AND status = 'failed')
         WHERE id = ?1`,
      ).bind(id),
    )
  }
  if (updates.length) await env.DB.batch(updates)
  await finishCompleted(env)
  return sent
}

// Рассылки, у которых не осталось очереди, — завершаем и шлём отчёт владельцу
async function finishCompleted(env: Env): Promise<void> {
  const { results: done } = await env.DB.prepare(
    `UPDATE broadcasts SET status = 'done', finished_at = ?
     WHERE status = 'sending'
       AND NOT EXISTS (SELECT 1 FROM broadcast_queue WHERE broadcast_id = broadcasts.id AND status = 'pending')
     RETURNING *`,
  )
    .bind(Date.now())
    .all<BroadcastRow>()
  for (const row of done) {
    await sendMessage(
      env,
      Number(env.OWNER_ID),
      `📣 <b>Рассылка #${row.id} завершена</b> (${escapeHtml(audienceTitle(row.audience ?? 'all'))})
✅ Доставлено: <b>${row.delivered}</b>
🚫 Заблокировали бота: <b>${row.blocked}</b>
⚠️ Ошибки: <b>${row.failed}</b>`,
    )
  }
}

// /broadcasts — последние 10
export async function listBroadcasts(env: Env, chatId: number): Promise<void> {
  const { results } = await env.DB.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 10').all<BroadcastRow>()
  if (!results.length) return void (await sendMessage(env, chatId, 'Рассылок ещё не было.'))
  const status = (row: BroadcastRow) => {
    switch (row.status) {
      case 'draft':
        return 'черновик'
      case 'cancelled':
        return 'отменена'
      case 'sending':
        return `⏳ идёт ${row.delivered + row.blocked + row.failed}/${row.total}`
      default:
        return `✅ ${row.delivered} · 🚫 ${row.blocked} · ⚠️ ${row.failed}`
    }
  }
  const lines = results.map((row) => {
    const plain = row.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const snippet = plain.length > 60 ? `${plain.slice(0, 60)}…` : plain
    return `<b>#${row.id}</b> · ${formatMsk(row.created_at)} · ${escapeHtml(audienceTitle(row.audience))} · ${status(row)}${row.photo ? ' · 🖼' : ''}\n«${escapeHtml(snippet || 'без текста')}»`
  })
  await sendMessage(env, chatId, `📣 <b>Последние рассылки</b>\n\n${lines.join('\n\n')}`)
}
