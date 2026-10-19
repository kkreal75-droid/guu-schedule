// Автосообщения в беседы (cron раз в минуту):
//   • в учебные дни (Пн–Сб) в выбранное время — пары на сегодня или «Сегодня пар нет 🎉»;
//   • в субботу в 19:00 — неделя вперёд;
//   • раз в 10 минут — сверка пар на 7 дней вперёд; изменились — «⚠️ Изменение в расписании».
// Расписание и настройки читаем только в те минуты, когда есть что делать.
import { WEEKDAYS_FULL, formatDate } from '../../shared/format-core'
import { isoFromDay, moscowNow, toMinutes, type Lesson, type Timetable } from '../../shared/schedule-core'
import { DIGEST_TIMES, forgetIfGone, loadChats, type ChatSettings } from './chats'
import { GROUPS, shortGroup } from './db'
import { reportError } from './errors'
import { formatDay, formatLesson, formatWeek, loadTimetable } from './schedule'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

const WEEKLY_AT = 19 * 60 // суббота, 19:00 МСК
const LATE_WINDOW = 10 // cron опоздал — досылаем в течение 10 минут
const MAX_SENDS = 20 // за один запуск (лимит 50 подзапросов делим с рассылками)

type Slot = { id: string; chats: [string, ChatSettings][]; text: (tt: Timetable, group: string) => string | null }

function dueSlots(day: number, minutes: number, weekday: number, chats: Record<string, ChatSettings>): Slot[] {
  const enabled = Object.entries(chats).filter(([, c]) => c.group && c.time)
  const inWindow = (at: number) => minutes >= at && minutes < at + LATE_WINDOW
  const slots: Slot[] = []
  if (weekday <= 5) {
    for (const time of DIGEST_TIMES) {
      if (!inWindow(toMinutes(time))) continue
      slots.push({
        id: `daily-${time}`,
        chats: enabled.filter(([, c]) => c.time === time),
        text: (tt, group) => {
          if (!tt.inSemester(tt.weekOf(day))) return null // каникулы — молчим
          const lessons = tt.lessonsOn(group, tt.weekOf(day), weekday)
          return lessons.length
            ? `☀️ ${formatDay(tt, day, group)}`
            : `☀️ <b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b> · ${escapeHtml(group)}\nСегодня пар нет 🎉`
        },
      })
    }
  }
  if (weekday === 5 && inWindow(WEEKLY_AT)) {
    slots.push({
      id: 'weekly',
      chats: enabled,
      text: (tt, group) => (tt.inSemester(tt.weekOf(day + 2)) ? formatWeek(tt, day + 2, group) : null),
    })
  }
  return slots
}

// Утренние сводки и субботняя неделя. Возвращает число отправленных сообщений.
export async function runDigests(env: Env, now: number): Promise<number> {
  const { day, minutes } = moscowNow(new Date(now))
  const weekday = (((day - 4) % 7) + 7) % 7 // 1970-01-01 — четверг; 0 = понедельник
  const anyTimeDue = weekday <= 5 && [...DIGEST_TIMES.map(toMinutes), WEEKLY_AT].some((at) => minutes >= at && minutes < at + LATE_WINDOW)
  if (!anyTimeDue) return 0

  const slots = dueSlots(day, minutes, weekday, await loadChats(env)).filter((s) => s.chats.length)
  if (!slots.length) return 0
  const tt = await loadTimetable(env)
  let sends = 0
  for (const slot of slots) {
    // кому уже отправили сегодня — запоминаем, чтобы повторный запуск cron не продублировал
    const sentKey = `sent:${isoFromDay(day)}:${slot.id}`
    const sent = new Set((await env.KV.get<string[]>(sentKey, 'json')) ?? [])
    const before = sent.size
    for (const [chatId, settings] of slot.chats) {
      if (sent.has(chatId) || sends >= MAX_SENDS) continue
      const text = slot.text(tt, settings.group!)
      sent.add(chatId)
      if (!text) continue
      sends++
      try {
        await sendMessage(env, Number(chatId), text)
      } catch (err) {
        if (!(await forgetIfGone(env, Number(chatId), err))) await reportError(env, `Сводка в беседу ${chatId}`, err)
      }
    }
    if (sent.size !== before) await env.KV.put(sentKey, JSON.stringify([...sent]), { expirationTtl: 3 * 86_400 })
  }
  return sends
}

// ---------- изменения в расписании ----------

type Snapshot = Record<string, string[]> // дата → пары строками

const lessonLine = (lesson: Lesson) => formatLesson(lesson) // HTML, тот же вид, что в сводке

function snapshot(tt: Timetable, group: string, today: number): Snapshot {
  const result: Snapshot = {}
  for (let day = today; day < today + 7; day++) {
    result[isoFromDay(day)] = tt.lessonsOn(group, tt.weekOf(day), tt.weekdayOf(day)).map(lessonLine)
  }
  return result
}

function describeChanges(previous: Snapshot, current: Snapshot): string[] {
  const blocks: string[] = []
  for (const [iso, lessons] of Object.entries(current)) {
    const before = previous[iso]
    if (!before) continue // день только что вошёл в окно — это не изменение
    const removed = before.filter((l) => !lessons.includes(l))
    const added = lessons.filter((l) => !before.includes(l))
    if (!removed.length && !added.length) continue
    const [y, m, d] = iso.split('-').map(Number)
    const day = Date.UTC(y, m - 1, d) / 86_400_000
    const weekday = (((day - 4) % 7) + 7) % 7
    blocks.push(
      [
        `<b>${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}</b>`,
        ...removed.map((l) => `❌ было: ${l}`),
        ...added.map((l) => `✅ стало: ${l}`),
        ...(lessons.length ? [] : ['Теперь в этот день пар нет 🎉']),
      ].join('\n'),
    )
  }
  return blocks
}

// Раз в 10 минут: сверяем пары на неделю вперёд со снимком в KV
export async function detectChanges(env: Env, now: number): Promise<number> {
  const { day } = moscowNow(new Date(now))
  const tt = await loadTimetable(env)
  let chats: Record<string, ChatSettings> | null = null
  let sends = 0
  for (const group of GROUPS) {
    const key = `snapshot:${shortGroup(group)}`
    const current = snapshot(tt, group, day)
    const previous = await env.KV.get<Snapshot>(key, 'json')
    const same = previous && JSON.stringify(previous) === JSON.stringify(current)
    if (same) continue
    await env.KV.put(key, JSON.stringify(current)) // окно сдвинулось на день или пары поменялись
    if (!previous) continue
    const blocks = describeChanges(previous, current)
    if (!blocks.length) continue

    chats ??= await loadChats(env)
    const text = `⚠️ <b>Изменение в расписании</b> · ${escapeHtml(group)}\n\n${blocks.join('\n\n')}`.slice(0, 4000)
    for (const [chatId, settings] of Object.entries(chats)) {
      if (settings.group !== group || !settings.time || sends >= MAX_SENDS) continue
      sends++
      try {
        await sendMessage(env, Number(chatId), text)
      } catch (err) {
        if (!(await forgetIfGone(env, Number(chatId), err))) await reportError(env, `Изменение в беседу ${chatId}`, err)
      }
    }
  }
  return sends
}
