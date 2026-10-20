// Inline-режим: «@бот завтра» в любом чате → карточка с парами.
// Запросы: пусто/сегодня, завтра, послезавтра, пн…сб (ближайший такой день), неделя.
import { WEEKDAYS_FULL, dateOf, formatDate, pluralPairs } from '../../shared/format-core'
import type { Timetable } from '../../shared/schedule-core'
import { profileOf } from './auth'
import { getUser, meOf, touchUser, userSubgroups } from './db'
import { economyMode } from './usage'
import { reportError } from './errors'
import { formatDay, formatWeek, groupsFor, loadTimetable, personalKey, todayMsk, type BotTimetable } from './schedule'
import { tg, type TgUser } from './telegram'

export type TgInlineQuery = { id: string; from: TgUser; query: string; chat_type?: string }

const DAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const DAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

type Target = { kind: 'day'; day: number; title: string } | { kind: 'week'; monday: number; title: string }

export function parseQuery(query: string, today: number, tt: Timetable): Target {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е')
  if (!q || q === 'сегодня' || q === 'today') return { kind: 'day', day: today, title: 'Сегодня' }
  if (q === 'завтра' || q === 'tomorrow') return { kind: 'day', day: today + 1, title: 'Завтра' }
  if (q === 'послезавтра') return { kind: 'day', day: today + 2, title: 'Послезавтра' }
  if (q.startsWith('недел') || q === 'week') {
    const weekday = tt.weekdayOf(today)
    // в воскресенье «неделя» — уже следующая
    return { kind: 'week', monday: today - weekday + (weekday === 6 ? 7 : 0), title: 'Неделя' }
  }
  const weekday = q.length >= 2 ? DAY_NAMES.findIndex((name, i) => q === DAY_SHORT[i] || name.startsWith(q)) : -1
  if (weekday >= 0) {
    const day = today + ((weekday - tt.weekdayOf(today) + 7) % 7) // ближайший, включая сегодня
    return { kind: 'day', day, title: WEEKDAYS_FULL[weekday] }
  }
  return { kind: 'day', day: today, title: 'Сегодня' }
}

function summary(tt: BotTimetable, target: Target, group: string): string {
  if (target.kind === 'week') {
    const { date, month } = dateOf(target.monday + 5)
    return `${formatDate(target.monday)} – ${date}.${String(month + 1).padStart(2, '0')}`
  }
  const lessons = tt.lessonsOn(group, tt.weekOf(target.day), tt.weekdayOf(target.day))
  const when = `${WEEKDAYS_FULL[tt.weekdayOf(target.day)]}, ${formatDate(target.day)}`
  if (!tt.inSemester(tt.weekOf(target.day))) return `${when} · вне семестра`
  return lessons.length
    ? `${when} · ${pluralPairs(lessons.length)}, ${lessons[0].start}–${lessons.at(-1)!.end}`
    : `${when} · пар нет`
}

// Inline-запрос летит на каждую букву: отмечаем человека (запись в D1) не чаще раза в минуту в этом изоляте,
// в остальное время и в режиме экономии — только читаем профиль (группа могла смениться в приложении)
const TOUCH_MS = 60_000
const touchedAt = new Map<number, number>()

export async function handleInlineQuery(env: Env, query: TgInlineQuery): Promise<void> {
  let group: string | null = null
  let banned = false
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
    // преподавателю — его пары, студенту — его группы
    group = personalKey({ role: user.me.role, teacher_id: user.me.teacher, grp: user.grp })
  } catch (err) {
    await reportError(env, 'Учёт пользователя (inline)', err)
  }
  if (banned) {
    await tg(env, 'answerInlineQuery', { inline_query_id: query.id, results: [], cache_time: 60, is_personal: true })
    return
  }

  const [tt, mine] = await Promise.all([
    loadTimetable(env, groupsFor(group)),
    userSubgroups(env.DB, query.from.id).catch(() => null),
  ])
  const today = todayMsk()
  const target = parseQuery(query.query, today, tt)
  const appLink = `https://t.me/${env.BOT_USERNAME}/schedule`
  const results = tt.schedule.groups.map((g) => ({
    type: 'article',
    id: `${target.kind}-${target.kind === 'day' ? target.day : target.monday}-${g}`,
    title: `${target.title} · ${tt.nameOf(g)}`,
    description: summary(tt, target, g),
    input_message_content: {
      message_text: target.kind === 'day' ? formatDay(tt, target.day, g, mine) : formatWeek(tt, target.monday, g, mine),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    },
    reply_markup: { inline_keyboard: [[{ text: '📅 Открыть расписание', url: appLink }]] },
  }))
  await tg(env, 'answerInlineQuery', { inline_query_id: query.id, results, cache_time: 60, is_personal: true })
}
