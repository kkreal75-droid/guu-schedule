// Личные сообщения боту: команды для всех и админские (только OWNER_ID).
import { banCommand, exportUsers, listBans, sendStats, unbanCommand } from './admin'
import { isOwner, profileOf } from './auth'
import { listBroadcasts, startBroadcast } from './broadcast'
import { getUser, personalOf, touchUser } from './db'
import { logAdmin } from './journal'
import { economyMode, usageText, usageToday } from './usage'
import { reportError, safely } from './errors'
import { formatDay, groupsFor, loadTimetable, personalKey, personalize, todayMsk } from './schedule'
import { DEFAULT_GREETINGS, loadSettings, renderGreeting } from './settings'
import { TelegramError, answerCallback, sendMessage, type TgCallbackQuery, type TgMessage } from './telegram'
import { escapeHtml } from './util'
import { handleSupportReply } from './support'
import { backupToOwner } from './backup'
import { deleteMeCommand } from './privacy'

export const BANNED_REPLY = 'Доступ к боту ограничен.'

type Context = { env: Env; ctx: ExecutionContext; message: TgMessage; args: string }
type Handler = (c: Context) => Promise<void>

// ---------- для всех ----------

// Приветствие — одно из трёх (тексты меняются в админ-панели). Telegram не принял HTML —
// шлём стандартное, а владельцу — ошибку.
export async function sendGreeting(env: Env, chatId: number, firstName: string | undefined, index?: number): Promise<void> {
  const name = escapeHtml(firstName?.trim() || 'брат')
  const { greetings } = await loadSettings(env).catch(() => ({ greetings: DEFAULT_GREETINGS }))
  const i = index ?? Math.floor(Math.random() * greetings.length)
  const extra = { reply_markup: { inline_keyboard: [[{ text: '📅 Открыть расписание', web_app: { url: env.WEBAPP_URL } }]] } }
  try {
    await sendMessage(env, chatId, renderGreeting(greetings[i], name), extra)
  } catch (err) {
    if (!(err instanceof TelegramError && err.code === 400) || greetings === DEFAULT_GREETINGS) throw err
    await sendMessage(env, chatId, renderGreeting(DEFAULT_GREETINGS[i] ?? DEFAULT_GREETINGS[0], name), extra)
    await reportError(env, `Приветствие №${i + 1} из админ-панели`, err)
  }
}

const start = ({ env, message }: Context) => sendGreeting(env, message.chat.id, message.from?.first_name)

// /today, /tomorrow — для группы, выбранной в приложении (преподавателю — его пары);
// не выбрана — для МБ(МП) 1-1 и 1-2
const dayCommand =
  (offset: number): Handler =>
  async ({ env, message }) => {
    const user = await getUser(env.DB, message.from!.id)
    const group = personalKey(user)
    // в личке — как в приложении: свои подгруппы и скрытые пары
    const [tt, personal] = await Promise.all([loadTimetable(env, groupsFor(group)), personalOf(env.DB, message.from!.id)])
    await sendMessage(env, message.chat.id, formatDay(personalize(tt, personal.hidden), todayMsk() + offset, group, personal.mine))
  }

const PUBLIC: Record<string, Handler> = {
  '/start': start,
  '/today': dayCommand(0),
  '/tomorrow': dayCommand(1),
}

// ---------- только для владельца ----------

const ADMIN: Record<string, Handler> = {
  '/stats': ({ env, message }) => sendStats(env, message.chat.id),
  '/broadcast': ({ env, message }) => startBroadcast(env, message),
  '/broadcasts': ({ env, message }) => listBroadcasts(env, message.chat.id),
  '/export': ({ env, message }) => exportUsers(env, message.chat.id),
  '/ban': ({ env, message, args }) => banCommand(env, message.chat.id, args),
  '/unban': ({ env, message, args }) => unbanCommand(env, message.chat.id, args),
  '/bans': ({ env, message }) => listBans(env, message.chat.id),
  '/usage': async ({ env, message }) => void (await sendMessage(env, message.chat.id, usageText(await usageToday(env)))),
  '/backup': async ({ env }) => void (await backupToOwner(env)),
}

export async function handlePrivateMessage(env: Env, ctx: ExecutionContext, message: TgMessage): Promise<void> {
  const from = message.from
  if (!from || from.is_bot) return
  // команда — в тексте или в подписи к фото («/broadcast» с картинкой)
  const text = (message.text ?? message.caption ?? '').trim()
  const command = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : null
  const args = text.replace(/^\S+\s*/, '')
  const owner = isOwner(env, from.id)

  // учёт не должен мешать ответу: база недоступна — сообщаем владельцу и отвечаем как обычно
  let banned = false
  try {
    // режим экономии: пишем только /start, остальное — чтение
    banned =
      economyMode() && command !== '/start'
        ? Boolean((await getUser(env.DB, from.id))?.banned)
        : (await touchUser(env.DB, profileOf(from), command === '/start' ? 'start' : 'message')).banned
  } catch (err) {
    await reportError(env, 'Учёт пользователя', err)
  }
  // удалить свои данные можно и с баном (бан при этом остаётся)
  if (command === '/deleteme') return void (await safely(env, 'Команда /deleteme', message.chat.id, () => deleteMeCommand(env, message)))
  if (banned && !owner) return void (await sendMessage(env, message.chat.id, BANNED_REPLY))
  // владелец отвечает на обращение в поддержку (ответом на «✍️ Ответ на обращение №…»)
  if (owner && !command && message.reply_to_message) {
    let handled = false
    await safely(env, 'Ответ в поддержку', message.chat.id, async () => {
      handled = await handleSupportReply(env, message)
    })
    if (handled) return
  }
  if (!command) return

  // админские команды у остальных — как несуществующие: ни ответа, ни намёка
  const handler = PUBLIC[command] ?? (owner ? ADMIN[command] : undefined)
  if (!handler) return
  if (owner && ADMIN[command] && command !== '/usage' && command !== '/stats' && command !== '/bans' && command !== '/broadcasts') {
    await logAdmin(env, from.id, command, null, args.slice(0, 300))
  }
  await safely(env, `Команда ${command}`, message.chat.id, () => handler({ env, ctx, message, args }))
}

export async function handleBannedCallback(env: Env, query: TgCallbackQuery): Promise<boolean> {
  if (isOwner(env, query.from.id)) return false
  const user = await getUser(env.DB, query.from.id)
  if (!user?.banned) return false
  await answerCallback(env, query.id, BANNED_REPLY)
  return true
}
