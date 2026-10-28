// Бот в беседе группы: настройка (/setup), /today, /tomorrow, /here, /off, сообщение при добавлении.
// Настройки всех бесед — один ключ KV «chats»: cron читает его раз в минуту (1 чтение),
// а пишем только при изменении настроек — лимит KV в 1000 записей в сутки не задеваем.
//
// Супергруппы с темами (форумы): отвечаем в ту тему, откуда пришла команда; сводки и
// «Изменение в расписании» — в тему, где сделали /setup (или /here). General — без темы.
//
// Язык беседы (этап 11) — ChatSettings.lang: при /setup — язык того, кто настраивает, потом — кнопки
// «🇷🇺 Русский / 🇬🇧 English» в «Готово». Старые беседы без языка — по-русски; ещё не настроенная — на языке
// того, кто пишет команду.
import { isOwner } from './auth'
import { getUser, type UserRow } from './db'
import { MB_GROUPS, mbName, normalizeGroup, searchGroups } from '../../shared/groups'
import { isLang } from '../../shared/i18n-core'
import { ERROR_REPLY, reportError } from './errors'
import { langOf, localeFor, tr, type Lang } from './i18n'
import { formatDay, groupsFor, loadGroupsIndex, loadTimetable, todayMsk } from './schedule'
import { TelegramError, answerCallback, sendMessage, tg, type TgCallbackQuery, type TgChat, type TgMessage, type TgUser } from './telegram'
import { escapeHtml } from './util'

export type ChatSettings = {
  title: string
  group: string | null // id группы («b1-mb-mp-1»); null — ещё не настроено. Раньше — имя «МБ(МП) 1-1»
  time: DigestTime | null // время сводки по Москве; null — автосообщения выключены
  thread?: number | null // тема форума для автосообщений; нет — General или беседа без тем
  lang?: Lang // язык сообщений; нет — русский
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

// Имя группы для сообщений: у МБ — сразу, у остальных — из groups.json (кэш)
async function groupTitle(env: Env, group: string): Promise<string> {
  const mb = mbName(group)
  if (mb) return mb
  const index = await loadGroupsIndex(env).catch(() => null)
  return index?.groups.find((g) => g.id === group)?.name ?? group
}

async function updateChats(env: Env, change: (chats: Record<string, ChatSettings>) => void): Promise<void> {
  const chats = await loadChats(env)
  change(chats)
  await env.KV.put(KEY, JSON.stringify(chats))
}

export const removeChat = (env: Env, chatId: number) => updateChats(env, (chats) => void delete chats[String(chatId)])

// Язык сообщений в беседу: настроенный; у настроенной раньше беседы без языка — русский;
// ещё не настроена — язык того, кто пишет (выбранный в приложении или язык Telegram)
export const chatLang = (settings: ChatSettings | undefined, user?: Pick<UserRow, 'lang' | 'lang_code'> | null, from?: TgUser) =>
  settings?.lang ?? (settings?.group ? 'ru' : langOf(user, from?.language_code))

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

const INTRO = `👋 Привет! Я присылаю расписание группы ГУУ в беседу:
• каждый учебный день утром — пары на сегодня;
• в субботу вечером — неделю вперёд;
• если пары поменяются — сразу напишу, что изменилось.

Админ беседы, настройте меня: /setup`

const groupKeyboard = () => ({
  inline_keyboard: [MB_GROUPS.map((g) => ({ text: g.short, callback_data: `gs:grp:${g.short}` }))],
})

const SETUP_HINT = 'Другая группа? Напишите /setup и её название — например, <code>/setup ГМУ 2-3</code>.'
const FOUND_MAX = 8

const timeKeyboard = (lang: Lang) => ({
  inline_keyboard: [
    DIGEST_TIMES.map((t) => ({ text: t.replace(/^0/, ''), callback_data: `gs:time:${t.replace(':', '')}` })),
    [{ text: tr(lang, 'Не присылать по утрам'), callback_data: 'gs:time:off' }],
  ],
})

// язык сообщений беседы — под «Готово»
const langKeyboard = (lang: Lang) => ({
  inline_keyboard: [
    [
      { text: `${lang === 'ru' ? '✓ ' : ''}🇷🇺 Русский`, callback_data: 'gs:lang:ru' },
      { text: `${lang === 'en' ? '✓ ' : ''}🇬🇧 English`, callback_data: 'gs:lang:en' },
    ],
  ],
})

// Добавили в беседу / удалили из неё (update my_chat_member)
export async function handleMembership(
  env: Env,
  update: { chat: TgChat; from?: TgUser; new_chat_member: { status: string }; old_chat_member: { status: string } },
): Promise<void> {
  if (!isGroupChat(update.chat)) return
  const inChat = (status: string) => ['member', 'administrator', 'creator', 'restricted'].includes(status)
  const wasIn = inChat(update.old_chat_member.status)
  const isIn = inChat(update.new_chat_member.status)
  if (!wasIn && isIn) {
    let settings: ChatSettings | undefined
    await updateChats(env, (chats) => {
      settings = chats[String(update.chat.id)] ??= { title: update.chat.title ?? '', group: null, time: null, added_at: Date.now() }
    })
    // знакомство — на языке того, кто добавил
    const adder = update.from ? await getUser(env.DB, update.from.id).catch(() => null) : null
    await sendMessage(env, update.chat.id, tr(chatLang(settings, adder, update.from), INTRO))
  } else if (wasIn && !isIn) {
    await removeChat(env, update.chat.id)
  }
}

// reply — ответ в ту же тему, откуда пришла команда; lang — язык беседы
type Reply = (text: string, extra?: object) => Promise<unknown>
type GroupCommand = (env: Env, message: TgMessage, settings: ChatSettings | undefined, reply: Reply, lang: Lang) => Promise<void>

const dayCommand =
  (offset: number): GroupCommand =>
  async (env, _message, settings, reply, lang) => {
    const [tt, loc] = await Promise.all([loadTimetable(env, groupsFor(settings?.group)), localeFor(env, lang)])
    await reply(formatDay(tt, todayMsk() + offset, settings?.group ?? null, null, loc))
  }

// /setup — быстрые кнопки МБ 1-1 / 1-2; /setup <название> — поиск по всем группам ГУУ
const setup: GroupCommand = async (env, message, _settings, reply, lang) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply(tr(lang, 'Настроить бота могут только админы беседы.'))
    return
  }
  const query = (message.text ?? '').replace(/^\S+\s*/, '').trim()
  if (!query) {
    await reply(`⚙️ <b>${tr(lang, 'Настройка')}</b>\n${tr(lang, 'Какая группа в этой беседе?')}\n${tr(lang, SETUP_HINT)}`, { reply_markup: groupKeyboard() })
    return
  }
  const found = searchGroups((await loadGroupsIndex(env)).groups, query, FOUND_MAX + 1)
  if (!found.length) {
    await reply(
      tr(lang, 'Не нашёл группу «{query}». Попробуйте иначе: <code>/setup МБ(МП) 1-1</code>, <code>/setup маркетинг 2</code>.', {
        query: escapeHtml(query.slice(0, 60)),
      }),
    )
    return
  }
  const shown = found.slice(0, FOUND_MAX)
  const more = found.length > FOUND_MAX ? `\n${tr(lang, 'Если вашей нет в списке — уточните название.')}` : ''
  await reply(`⚙️ <b>${tr(lang, 'Настройка')}</b>\n${tr(lang, 'Выберите группу:')}${more}`, {
    reply_markup: {
      inline_keyboard: shown.map((g) => [
        {
          text: tr(lang, '{name} · {institute}, {course} к.', { name: g.name, institute: g.institute, course: g.course }).slice(0, 60),
          callback_data: `gs:g:${g.id}`,
        },
      ]),
    },
  })
}

const HERE_DONE = 'Готово! Буду присылать расписание в эту тему 👍'

// /here — автосообщения в эту тему (в беседе с темами)
const here: GroupCommand = async (env, message, settings, reply, lang) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply(tr(lang, 'Перепривязать рассылку могут только админы беседы.'))
    return
  }
  if (!settings?.group) {
    await reply(tr(lang, 'Сначала настройте бота: /setup'))
    return
  }
  const thread = threadOf(message)
  await updateChats(env, (chats) => {
    const chat = chats[String(message.chat.id)]
    if (chat) chat.thread = thread
  })
  await reply(tr(lang, message.chat.is_forum ? HERE_DONE : 'Готово! Буду присылать расписание сюда 👍'))
}

const off: GroupCommand = async (env, message, _settings, reply, lang) => {
  if (!message.from || !(await isChatAdmin(env, message.chat.id, message.from.id))) {
    await reply(tr(lang, 'Выключить бота могут только админы беседы.'))
    return
  }
  await updateChats(env, (chats) => {
    const chat = chats[String(message.chat.id)]
    if (chat) chat.time = null
  })
  await reply(tr(lang, '🔕 Автосообщения выключены. /today и /tomorrow работают как раньше, включить снова — /setup.'))
}

const GROUP_COMMANDS: Record<string, GroupCommand> = {
  '/start': async (_env, _message, _settings, reply, lang) => void (await reply(tr(lang, INTRO))), // ссылка ?startgroup=setup
  '/setup': setup,
  '/today': dayCommand(0),
  '/tomorrow': dayCommand(1),
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
  // забаненному боту и в беседах не отвечаем (владелец — исключение)
  const user = message.from ? await getUser(env.DB, message.from.id) : null
  if (message.from && !isOwner(env, message.from.id) && user?.banned) return

  const thread = threadOf(message)
  const reply: Reply = (text, extra = {}) => sendMessage(env, message.chat.id, text, { ...inThread(thread), ...extra })
  const settings = (await loadChats(env))[String(message.chat.id)]
  const lang = chatLang(settings, user, message.from)
  try {
    await handler(env, message, settings, reply, lang)
  } catch (err) {
    // тема закрыта или удалена — в General не пишем, только владельцу
    if (isThreadError(err)) {
      await reportError(env, `Ответ на ${command} не ушёл в тему (удалена или закрыта?) — ${chatLabel(message.chat.id, settings, thread)}`, err)
      return
    }
    await reply(tr(lang, ERROR_REPLY)).catch(() => {})
    await reportError(env, `Команда ${command} — ${chatLabel(message.chat.id, settings, thread)}`, err)
  }
}

// Кнопки настройки: gs:grp:1-1, gs:g:<id>, gs:time:0730, gs:time:off, gs:lang:en. Ошибка — всплывающим текстом
// на кнопке (не сообщением в беседу: в форуме оно ушло бы в General) и владельцу.
export async function onGroupSetupButton(env: Env, query: TgCallbackQuery): Promise<void> {
  try {
    await setupStep(env, query)
  } catch (err) {
    await answerCallback(env, query.id, tr(langOf(null, query.from.language_code), ERROR_REPLY)).catch(() => {})
    throw err
  }
}

// «Готово» после настройки: что и когда пришлю, команды, язык сообщений (кнопки)
async function doneMessage(env: Env, chat: TgChat, settings: ChatSettings): Promise<{ text: string; reply_markup: object }> {
  const lang = settings.lang ?? 'ru'
  const { time, group } = settings
  const done = time
    ? tr(lang, 'Каждый учебный день в {time} пришлю пары{group}, по субботам вечером — неделю вперёд, а если расписание поменяется — сразу напишу.', {
        time: time.replace(/^0/, ''),
        group: group ? ` <b>${escapeHtml(await groupTitle(env, group))}</b>` : '',
      })
    : tr(lang, 'По утрам присылать не буду. Пары можно посмотреть командами ниже.')
  const title = time && chat.is_forum ? tr(lang, HERE_DONE) : `✅ <b>${tr(lang, 'Готово')}</b>`
  const hereHint = chat.is_forum ? `\n${tr(lang, '/here — присылать в другую тему (написать в ней)')}` : ''
  const commands = `${tr(lang, '/today — пары на сегодня\n/tomorrow — на завтра')}${hereHint}\n${tr(lang, '/off — выключить автосообщения\n/setup — настроить заново')}`
  return { text: `${title}\n${done}\n\n${commands}\n\n${tr(lang, 'Язык сообщений:')}`, reply_markup: langKeyboard(lang) }
}

async function setupStep(env: Env, query: TgCallbackQuery): Promise<void> {
  const chat = query.message?.chat
  if (!chat || !isGroupChat(chat)) return void (await answerCallback(env, query.id))
  // /setup вызвали в этой теме — сюда и будем присылать
  const thread = threadOf(query.message)
  // всплывающие подсказки — на языке нажавшего, сообщение — на языке беседы (ещё нет — нажавшего)
  const pressLang = langOf(null, query.from.language_code)
  if (!(await isChatAdmin(env, chat.id, query.from.id))) {
    await answerCallback(env, query.id, tr(pressLang, 'Настроить бота могут только админы беседы'))
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

  if (step === 'grp' || step === 'g') {
    // grp:1-1 — быстрые кнопки МБ; g:<id> — найденная поиском группа
    const group =
      step === 'grp'
        ? MB_GROUPS.find((g) => g.short === value)?.id
        : (await loadGroupsIndex(env)).groups.find((g) => g.id === normalizeGroup(value))?.id
    if (!group) return void (await answerCallback(env, query.id, tr(pressLang, 'Такой группы больше нет — повторите /setup')))
    let lang: Lang = pressLang
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      lang = current?.lang ?? pressLang // язык беседы — того, кто настраивает (потом — кнопками)
      chats[String(chat.id)] = {
        title: chat.title ?? current?.title ?? '',
        group,
        time: current?.time ?? null,
        thread,
        lang,
        added_at: current?.added_at ?? Date.now(),
      }
    })
    await edit(
      `⚙️ <b>${tr(lang, 'Настройка')}</b>\n${tr(lang, 'Группа: <b>{group}</b>.', { group: escapeHtml(await groupTitle(env, group)) })}\n${tr(lang, 'Во сколько присылать пары на день (по Москве)?')}`,
      timeKeyboard(lang),
    )
    await answerCallback(env, query.id)
    return
  }
  if (step === 'time') {
    const asTime = `${value.slice(0, 2)}:${value.slice(2)}` // «0730» → «07:30»
    const time = (DIGEST_TIMES as string[]).includes(asTime) ? (asTime as DigestTime) : null
    let saved: ChatSettings | null = null
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      saved = chats[String(chat.id)] = {
        title: chat.title ?? current?.title ?? '',
        group: current?.group ?? null,
        time,
        thread,
        lang: current?.lang ?? pressLang,
        added_at: current?.added_at ?? Date.now(),
      }
    })
    const done = await doneMessage(env, chat, saved!)
    await edit(done.text, done.reply_markup)
    await answerCallback(env, query.id, tr(pressLang, 'Сохранено'))
    return
  }
  if (step === 'lang' && isLang(value)) {
    // язык сообщений беседы: «Готово» перерисовываем на новом языке
    let saved: ChatSettings | null = null
    await updateChats(env, (chats) => {
      const current = chats[String(chat.id)]
      if (current) saved = Object.assign(current, { lang: value })
    })
    if (!saved) return void (await answerCallback(env, query.id, tr(pressLang, 'Сначала настройте бота: /setup')))
    const done = await doneMessage(env, chat, saved)
    await edit(done.text, done.reply_markup).catch((err) => {
      if (!(err instanceof TelegramError && /not modified/i.test(err.description))) throw err
    })
    await answerCallback(env, query.id, tr(value, 'Сохранено'))
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

