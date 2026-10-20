// Бот в беседе группы: настройка (/setup), /today, /tomorrow, /here, /off, сообщение при добавлении.
// Настройки всех бесед — один ключ KV «chats»: cron читает его раз в минуту (1 чтение),
// а пишем только при изменении настроек — лимит KV в 1000 записей в сутки не задеваем.
//
// Супергруппы с темами (форумы): отвечаем в ту тему, откуда пришла команда; сводки и
// «Изменение в расписании» — в тему, где сделали /setup (или /here). General — без темы.
import { MB_GROUPS, mbName, normalizeGroup } from '../../shared/groups'
import { ERROR_REPLY, reportError } from './errors'
import { formatDay, groupsFor, loadTimetable, todayMsk } from './schedule'
import { TelegramError, answerCallback, sendMessage, tg, type TgCallbackQuery, type TgChat, type TgMessage } from './telegram'
import { escapeHtml } from './util'

export type ChatSettings = {
  title: string
  group: string | null // id группы («b1-mb-mp-1»); null — ещё не настроено. Раньше — имя «МБ(МП) 1-1»
  time: DigestTime | null // время сводки по Москве; null — автосообщения выключены
  thread?: number | null // тема форума для автосообщений; нет — General или беседа без тем
  added_at: number
}
export type DigestTime = '07:00' | '07:30' | '08:00'
export const DIGEST_TIMES: DigestTime[] = ['07:00', '07:30', '08:00']

const KEY = 'chats'

// Старые настройки хранили имя группы («МБ(МП) 1-1») — один раз переводим в id и сохраняем
export async function loadChats(env: Env): Promise<Record<string, ChatSettings>> {
  const chats = (await env.KV.get<Record<string, ChatSettings>>(KEY, 'json')) ?? {}
  let migrated = false
  for (const settings of Object.values(chats)) {
    const id = settings.group ? normalizeGroup(settings.group) : null
    if (settings.group && id !== settings.group) {
      settings.group = id
      migrated = true
    }
  }
  if (migrated) await env.KV.put(KEY, JSON.stringify(chats))
  return chats
}

const groupTitle = (group: string) => mbName(group) ?? group

async function updateChats(env: Env, change: (chats: Record<string, ChatSettings>) => void): Promise<void> {
  const chats = await loadChats(env)
  change(chats)
  await env.KV.put(KEY, JSON.stringify(chats))
}

export const removeChat = (env: Env, chatId: number) => updateChats(env, (chats) => void delete chats[String(chatId)])

const isGroupChat = (chat: TgChat) => chat.type === 'group' || chat.type === 'supergroup'

// Тема, из которой пришло сообщение; null — General или беседа без тем
export const threadOf = (message: TgMessage | undefined) =>
  message?.is_topic_message && message.message_thread_id ? message.message_thread_id : null

// Параметр для sendMessage: в General и в обычных беседах тему не передаём
export const inThread = (thread: number | null | undefined) => (thread ? { message_thread_id: thread } : {})

// Тему удалили или закрыли — в General не пишем, сообщаем владельцу
export const isThreadError = (err: unknown) =>
  err instanceof TelegramError &&
  err.code === 400 &&
  /thread not found|topic_(closed|deleted|id_invalid)|topic (is )?(closed|deleted)/i.test(err.description)

export const chatLabel = (chatId: string | number, settings: ChatSettings | undefined, thread: number | null | undefined) =>
  `беседа «${settings?.title || chatId}»${thread ? `, тема ${thread}` : ''}`

async function isChatAdmin(env: Env, chatId: number, userId: number): Promise<boolean> {
  const member = await tg<{ status: string }>(env, 'getChatMember', { chat_id: chatId, user_id: userId })
  return member.status === 'creator' || member.status === 'administrator'
}

// ---------- сообщения ----------

const INTRO = `👋 Привет! Я присылаю расписание МБ(МП) в беседу:
• каждый учебный день утром — пары на сегодня;
• в субботу вечером — неделю вперёд;
• если пары поменяются — сразу напишу, что изменилось.

Админ беседы, настройте меня: /setup`

const groupKeyboard = () => ({
  inline_keyboard: [MB_GROUPS.map((g) => ({ text: g.short, callback_data: `gs:grp:${g.short}` }))],
})

const timeKeyboard = () => ({
  inline_keyboard: [
    DIGEST_TIMES.map((t) => ({ text: t.replace(/^0/, ''), callback_data: `gs:time:${t.replace(':', '')}` })),
    [{ text: 'Не присылать по утрам', callback_data: 'gs:time:off' }],
  ],
})

// Добавили в беседу / удалили из неё (update my_chat_member)
export async function handleMembership(
  env: Env,
  update: { chat: TgChat; new_chat_member: { status: string }; old_chat_member: { status: string } },
): Promise<void> {
  if (!isGroupChat(update.chat)) return
  const inChat = (status: string) => ['member', 'administrator', 'creator', 'restricted'].includes(status)
  const wasIn = inChat(update.old_chat_member.status)
  const isIn = inChat(update.new_chat_member.status)
  if (!wasIn && isIn) {
    await updateChats(env, (chats) => {
      chats[String(update.chat.id)] ??= { title: update.chat.title ?? '', group: null, time: null, added_at: Date.now() }
    })
    await sendMessage(env, update.chat.id, INTRO)
  } else if (wasIn && !isIn) {
    await removeChat(env, update.chat.id)
  }
}

// reply — ответ в ту же тему, откуда пришла команда
type Reply = (text: string, extra?: object) => Promise<unknown>
type GroupCommand = (env: Env, message: TgMessage, settings: ChatSettings | undefined, reply: Reply) => Promise<void>

const today: GroupCommand = async (env, _message, settings, reply) =>
  void (await reply(formatDay(await loadTimetable(env, groupsFor(settings?.group)), todayMsk(), settings?.group ?? null)))

const tomorrow: GroupCommand = async (env, _message, settings, reply) =>
  void (await reply(formatDay(await loadTimetable(env, groupsFor(settings?.group)), todayMsk() + 1, settings?.group ?? null)))

const setup: GroupCommand = async (env, message, _settings, reply) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply('Настроить бота могут только админы беседы.')
    return
  }
  await reply('⚙️ <b>Настройка</b>\nКакая группа в этой беседе?', { reply_markup: groupKeyboard() })
}

const HERE_DONE = 'Готово! Буду присылать расписание в эту тему 👍'

// /here — автосообщения в эту тему (в беседе с темами)
const here: GroupCommand = async (env, message, settings, reply) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply('Перепривязать рассылку могут только админы беседы.')
    return
  }
  if (!settings?.group) {
    await reply('Сначала настройте бота: /setup')
    return
  }
  const thread = threadOf(message)
  await updateChats(env, (chats) => {
    const chat = chats[String(message.chat.id)]
    if (chat) chat.thread = thread
  })
  await reply(message.chat.is_forum ? HERE_DONE : 'Готово! Буду присылать расписание сюда 👍')
}

const off: GroupCommand = async (env, message, _settings, reply) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply('Выключить бота могут только админы беседы.')
    return
  }
  await updateChats(env, (chats) => {
    const chat = chats[String(message.chat.id)]
    if (chat) chat.time = null
  })
  await reply('🔕 Автосообщения выключены. /today и /tomorrow работают как раньше, включить снова — /setup.')
}

const GROUP_COMMANDS: Record<string, GroupCommand> = {
  '/start': async (_env, _message, _settings, reply) => void (await reply(INTRO)), // ссылка ?startgroup=setup
  '/setup': setup,
  '/today': today,
  '/tomorrow': tomorrow,
  '/here': here,
  '/off': off,
}

export async function handleGroupMessage(env: Env, message: TgMessage): Promise<void> {
  // беседа стала супергруппой — у неё новый id, переносим настройки
  const migrated = (message as TgMessage & { migrate_to_chat_id?: number }).migrate_to_chat_id
  if (migrated) {
    await updateChats(env, (chats) => {
      const settings = chats[String(message.chat.id)]
      if (settings) chats[String(migrated)] = settings
      delete chats[String(message.chat.id)]
    })
    return
  }
  const text = message.text?.trim() ?? ''
  if (!text.startsWith('/')) return
  const [head] = text.split(/\s+/)
  const [command, mention] = head.toLowerCase().split('@')
  // в беседе может быть несколько ботов: «/today@другой_бот» — не нам
  if (mention && mention !== env.BOT_USERNAME.toLowerCase()) return
  const handler = GROUP_COMMANDS[command]
  if (!handler) return

  const thread = threadOf(message)
  const reply: Reply = (text, extra = {}) => sendMessage(env, message.chat.id, text, { ...inThread(thread), ...extra })
  const settings = (await loadChats(env))[String(message.chat.id)]
  try {
    await handler(env, message, settings, reply)
  } catch (err) {
    // тема закрыта или удалена — в General не пишем, только владельцу
    if (isThreadError(err)) {
      await reportError(env, `Ответ на ${command} не ушёл в тему (удалена или закрыта?) — ${chatLabel(message.chat.id, settings, thread)}`, err)
      return
    }
    await reply(ERROR_REPLY).catch(() => {})
    await reportError(env, `Команда ${command} — ${chatLabel(message.chat.id, settings, thread)}`, err)
  }
}

// Кнопки настройки: gs:grp:1-1, gs:time:0730, gs:time:off. Ошибка — всплывающим текстом на кнопке
// (не сообщением в беседу: в форуме оно ушло бы в General) и владельцу.
export async function onGroupSetupButton(env: Env, query: TgCallbackQuery): Promise<void> {
  try {
    await setupStep(env, query)
  } catch (err) {
    await answerCallback(env, query.id, ERROR_REPLY).catch(() => {})
    throw err
  }
}

async function setupStep(env: Env, query: TgCallbackQuery): Promise<void> {
  const chat = query.message?.chat
  if (!chat || !isGroupChat(chat)) return void (await answerCallback(env, query.id))
  // /setup вызвали в этой теме — сюда и будем присылать
  const thread = threadOf(query.message)
  if (!(await isChatAdmin(env, chat.id, query.from.id))) {
    await answerCallback(env, query.id, 'Настроить бота могут только админы беседы')
    return
  }
  const [, step, value = ''] = (query.data ?? '').split(':')
  const edit = (text: string, reply_markup?: object) =>
    tg(env, 'editMessageText', {
      chat_id: chat.id,
      message_id: query.message!.message_id,
      text,
      parse_mode: 'HTML',
      ...(reply_markup ? { reply_markup } : {}),
    })

  if (step === 'grp') {
    const group = MB_GROUPS.find((g) => g.short === value)?.id
    if (!group) return void (await answerCallback(env, query.id))
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      chats[String(chat.id)] = {
        title: chat.title ?? current?.title ?? '',
        group,
        time: current?.time ?? null,
        thread,
        added_at: current?.added_at ?? Date.now(),
      }
    })
    await edit(`⚙️ <b>Настройка</b>\nГруппа: <b>${escapeHtml(groupTitle(group))}</b>.\nВо сколько присылать пары на день (по Москве)?`, timeKeyboard())
    await answerCallback(env, query.id)
    return
  }
  if (step === 'time') {
    const asTime = `${value.slice(0, 2)}:${value.slice(2)}` // «0730» → «07:30»
    const time = (DIGEST_TIMES as string[]).includes(asTime) ? (asTime as DigestTime) : null
    let group: string | null = null
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      group = current?.group ?? null
      chats[String(chat.id)] = { title: chat.title ?? current?.title ?? '', group, time, thread, added_at: current?.added_at ?? Date.now() }
    })
    const done = time
      ? `Каждый учебный день в ${time.replace(/^0/, '')} пришлю пары${group ? ` <b>${escapeHtml(groupTitle(group))}</b>` : ''}, по субботам вечером — неделю вперёд, а если расписание поменяется — сразу напишу.`
      : 'По утрам присылать не буду. Пары можно посмотреть командами ниже.'
    const title = time && chat.is_forum ? HERE_DONE : '✅ <b>Готово</b>'
    const hereHint = chat.is_forum ? '\n/here — присылать в другую тему (написать в ней)' : ''
    await edit(`${title}\n${done}\n\n/today — пары на сегодня\n/tomorrow — на завтра${hereHint}\n/off — выключить автосообщения\n/setup — настроить заново`)
    await answerCallback(env, query.id, 'Сохранено')
    return
  }
  await answerCallback(env, query.id)
}

// Беседа выгнала бота или запретила писать — забываем её
export async function forgetIfGone(env: Env, chatId: number, err: unknown): Promise<boolean> {
  if (err instanceof TelegramError && (err.code === 403 || /chat not found|group chat was upgraded/i.test(err.description))) {
    await removeChat(env, chatId)
    return true
  }
  return false
}

