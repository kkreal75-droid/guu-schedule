// Бот в беседе группы: настройка (/setup), /today, /tomorrow, /off, сообщение при добавлении.
// Настройки всех бесед — один ключ KV «chats»: cron читает его раз в минуту (1 чтение),
// а пишем только при изменении настроек — лимит KV в 1000 записей в сутки не задеваем.
import { GROUPS, shortGroup } from './db'
import { formatDay, loadTimetable, todayMsk } from './schedule'
import { TelegramError, answerCallback, sendMessage, tg, type TgCallbackQuery, type TgChat, type TgMessage } from './telegram'
import { escapeHtml } from './util'

export type ChatSettings = {
  title: string
  group: string | null // «МБ(МП) 1-1» / «МБ(МП) 1-2»; null — ещё не настроено
  time: DigestTime | null // время сводки по Москве; null — автосообщения выключены
  added_at: number
}
export type DigestTime = '07:00' | '07:30' | '08:00'
export const DIGEST_TIMES: DigestTime[] = ['07:00', '07:30', '08:00']

const KEY = 'chats'

export async function loadChats(env: Env): Promise<Record<string, ChatSettings>> {
  return (await env.KV.get<Record<string, ChatSettings>>(KEY, 'json')) ?? {}
}

async function updateChats(env: Env, change: (chats: Record<string, ChatSettings>) => void): Promise<void> {
  const chats = await loadChats(env)
  change(chats)
  await env.KV.put(KEY, JSON.stringify(chats))
}

export const removeChat = (env: Env, chatId: number) => updateChats(env, (chats) => void delete chats[String(chatId)])

const isGroupChat = (chat: TgChat) => chat.type === 'group' || chat.type === 'supergroup'

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
  inline_keyboard: [GROUPS.map((g) => ({ text: shortGroup(g), callback_data: `gs:grp:${shortGroup(g)}` }))],
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

type GroupCommand = (env: Env, message: TgMessage, settings: ChatSettings | undefined) => Promise<void>

const today: GroupCommand = async (env, message, settings) =>
  void (await sendMessage(env, message.chat.id, formatDay(await loadTimetable(env), todayMsk(), settings?.group ?? null)))

const tomorrow: GroupCommand = async (env, message, settings) =>
  void (await sendMessage(env, message.chat.id, formatDay(await loadTimetable(env), todayMsk() + 1, settings?.group ?? null)))

const setup: GroupCommand = async (env, message) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await sendMessage(env, message.chat.id, 'Настроить бота могут только админы беседы.')
    return
  }
  await sendMessage(env, message.chat.id, '⚙️ <b>Настройка</b>\nКакая группа в этой беседе?', { reply_markup: groupKeyboard() })
}

const off: GroupCommand = async (env, message) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await sendMessage(env, message.chat.id, 'Выключить бота могут только админы беседы.')
    return
  }
  await updateChats(env, (chats) => {
    const chat = chats[String(message.chat.id)]
    if (chat) chat.time = null
  })
  await sendMessage(env, message.chat.id, '🔕 Автосообщения выключены. /today и /tomorrow работают как раньше, включить снова — /setup.')
}

const GROUP_COMMANDS: Record<string, GroupCommand> = {
  '/start': async (env, message) => void (await sendMessage(env, message.chat.id, INTRO)), // ссылка ?startgroup=setup
  '/setup': setup,
  '/today': today,
  '/tomorrow': tomorrow,
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
  await handler(env, message, (await loadChats(env))[String(message.chat.id)])
}

// Кнопки настройки: gs:grp:1-1, gs:time:0730, gs:time:off
export async function onGroupSetupButton(env: Env, query: TgCallbackQuery): Promise<void> {
  const chat = query.message?.chat
  if (!chat || !isGroupChat(chat)) return void (await answerCallback(env, query.id))
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
    const group = GROUPS.find((g) => shortGroup(g) === value)
    if (!group) return void (await answerCallback(env, query.id))
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      chats[String(chat.id)] = { title: chat.title ?? current?.title ?? '', group, time: current?.time ?? null, added_at: current?.added_at ?? Date.now() }
    })
    await edit(`⚙️ <b>Настройка</b>\nГруппа: <b>${escapeHtml(group)}</b>.\nВо сколько присылать пары на день (по Москве)?`, timeKeyboard())
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
      chats[String(chat.id)] = { title: chat.title ?? current?.title ?? '', group, time, added_at: current?.added_at ?? Date.now() }
    })
    const done = time
      ? `Каждый учебный день в ${time.replace(/^0/, '')} пришлю пары${group ? ` <b>${escapeHtml(group)}</b>` : ''}, по субботам вечером — неделю вперёд, а если расписание поменяется — сразу напишу.`
      : 'По утрам присылать не буду. Пары можно посмотреть командами ниже.'
    await edit(`✅ <b>Готово</b>\n${done}\n\n/today — пары на сегодня\n/tomorrow — на завтра\n/off — выключить автосообщения\n/setup — настроить заново`)
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

