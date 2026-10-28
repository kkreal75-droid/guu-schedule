// Inline-режим: «@бот завтра» в любом чате → карточка с парами.
// Запросы: пусто/сегодня, завтра, послезавтра, пн…сб (ближайший такой день), неделя — и то же по-английски
// (today, tomorrow, mon…sun, week). Карточки — на языке человека.
import { dayLessons } from '../../shared/edits-core'
import { WEEKDAYS_FULL, dateOf, formatDate, pluralPairs } from '../../shared/format-core'
import { dayMonthShort, weekdayName } from '../../shared/i18n-core'
import { dayOffTitle, type Timetable } from '../../shared/schedule-core'
import { profileOf } from './auth'
import { getUser, meOf, personalOf, touchUser } from './db'
import { economyMode } from './usage'
import { reportError } from './errors'
import { formatDay, formatWeek, groupsFor, loadTimetable, personalKey, personalize, todayMsk, type BotTimetable } from './schedule'
import { langOf, localeFor, tr, type Lang } from './i18n'
import { tg, type TgUser } from './telegram'

export type TgInlineQuery = { id: string; from: TgUser; query: string; chat_type?: string }

const DAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const DAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const DAY_NAMES_EN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

type Target = { kind: 'day'; day: number; title: string } | { kind: 'week'; monday: number; title: string }

export function parseQuery(query: string, today: number, tt: Timetable, lang: Lang = 'ru'): Target {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е')
  const todayTarget: Target = { kind: 'day', day: today, title: tr(lang, 'Сегодня') }
  if (!q || q === 'сегодня' || q === 'today') return todayTarget
  if (q === 'завтра' || q === 'tomorrow') return { kind: 'day', day: today + 1, title: tr(lang, 'Завтра') }
  if (q === 'послезавтра' || q === 'day after tomorrow') return { kind: 'day', day: today + 2, title: tr(lang, 'Послезавтра') }
  if (q.startsWith('недел') || q === 'week') {
    const weekday = tt.weekdayOf(today)
    // в воскресенье «неделя» — уже следующая
    return { kind: 'week', monday: today - weekday + (weekday === 6 ? 7 : 0), title: tr(lang, 'Неделя') }
  }
  const weekday =
    q.length >= 2 ? DAY_NAMES.findIndex((name, i) => q === DAY_SHORT[i] || name.startsWith(q) || DAY_NAMES_EN[i].startsWith(q)) : -1
  if (weekday >= 0) {
    const day = today + ((weekday - tt.weekdayOf(today) + 7) % 7) // ближайший, включая сегодня
    return { kind: 'day', day, title: lang === 'en' ? weekdayName(weekday, 'en') : WEEKDAYS_FULL[weekday] }
  }
  return todayTarget
}

// «Среда, 21.10 · 4 пары, 09:00–16:05» — те же пары, что в сообщении (правки, подгруппы, скрытые пары)
function summary(tt: BotTimetable, target: Target, group: string, mine: number[] | null, lang: Lang): string {
  if (target.kind === 'week') {
    if (lang === 'en') return `${dayMonthShort(target.monday, 'en')} – ${dayMonthShort(target.monday + 5, 'en')}`
    const { date, month } = dateOf(target.monday + 5)
    return `${formatDate(target.monday)} – ${date}.${String(month + 1).padStart(2, '0')}`
  }
  const lessons = dayLessons(tt, group, target.day, tt.extras, mine).lessons.filter((l) => !l.cancel && !l.movedTo)
  const weekday = tt.weekdayOf(target.day)
  const when = `${lang === 'en' ? weekdayName(weekday, 'en') : WEEKDAYS_FULL[weekday]}, ${formatDate(target.day, lang)}`
  if (!tt.inSemester(tt.weekOf(target.day))) return `${when} · ${tr(lang, 'вне семестра')}`
  const off = tt.dayOff(target.day)
  if (off) return `${when} · ${tr(lang, 'выходной — {title}', { title: dayOffTitle(off, lang) })}`
  return lessons.length
    ? `${when} · ${pluralPairs(lessons.length, lang)}, ${lessons[0].start}–${lessons.at(-1)!.end}`
    : `${when} · ${tr(lang, 'пар нет')}`
}

// Inline-запрос летит на каждую букву: отмечаем человека (запись в D1) не чаще раза в минуту в этом изоляте,
// в остальное время и в режиме экономии — только читаем профиль (группа могла смениться в приложении)
const TOUCH_MS = 60_000
const touchedAt = new Map<number, number>()

export async function handleInlineQuery(env: Env, query: TgInlineQuery): Promise<void> {
  let group: string | null = null
  let banned = false
  let lang = langOf(null, query.from.language_code)
  try {
    const recent = Date.now() - (touchedAt.get(query.from.id) ?? 0) < TOUCH_MS
    const user =
      recent || economyMode()
        ? await getUser(env.DB, query.from.id).then((row) => ({ banned: Boolean(row?.banned), me: meOf(row), grp: row?.grp ?? null }))
        : await touchUser(env.DB, profileOf(query.from), 'inline')
    if (!recent) {
      touchedAt.set(query.from.id, Date.now())
      if (touchedAt.size > 2000) touchedAt.delete(touchedAt.keys().next().value!)
    }
    banned = user.banned
    lang = langOf(user.me, query.from.language_code)
    // преподавателю — его пары, студенту — его группы
    group = personalKey({ role: user.me.role, teacher_id: user.me.teacher, grp: user.grp })
  } catch (err) {
    await reportError(env, 'Учёт пользователя (inline)', err)
  }
  if (banned) {
    await tg(env, 'answerInlineQuery', { inline_query_id: query.id, results: [], cache_time: 60, is_personal: true })
    return
  }

  // скрытые человеком пары и его подгруппы — как в приложении
  const [loaded, personal, loc] = await Promise.all([
    loadTimetable(env, groupsFor(group)),
    personalOf(env.DB, query.from.id).catch(() => ({ mine: null, hidden: [], lang })),
    localeFor(env, lang),
  ])
  const tt = personalize(loaded, personal.hidden)
  const mine = personal.mine
  const today = todayMsk()
  const target = parseQuery(query.query, today, tt, lang)
  const appLink = `https://t.me/${env.BOT_USERNAME}/schedule`
  const results = tt.schedule.groups.map((g) => ({
    type: 'article',
    id: `${target.kind}-${target.kind === 'day' ? target.day : target.monday}-${g}`,
    title: `${target.title} · ${tt.nameOf(g)}`,
    description: summary(tt, target, g, mine, lang),
    input_message_content: {
      message_text: target.kind === 'day' ? formatDay(tt, target.day, g, mine, loc) : formatWeek(tt, target.monday, g, mine, loc),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    },
    reply_markup: { inline_keyboard: [[{ text: tr(lang, '📅 Открыть расписание'), url: appLink }]] },
  }))
  await tg(env, 'answerInlineQuery', { inline_query_id: query.id, results, cache_time: 60, is_personal: true })
}
