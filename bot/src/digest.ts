// Автосообщения в беседы (cron раз в минуту):
//   • в учебные дни (Пн–Сб) в выбранное время — пары на сегодня или «Сегодня пар нет 🎉»;
//   • в субботу в 19:00 — неделя вперёд;
//   • раз в 10 минут — сверка пар на 7 дней вперёд; изменились — «⚠️ Изменение в расписании».
// Расписание и настройки читаем только в те минуты, когда есть что делать, и только для групп,
// к которым привязаны беседы. Снимки «пары на 7 дней» — в D1 (group_snapshots): групп много,
// а у KV всего 1000 записей в сутки.
import { WEEKDAYS_FULL, formatDate } from '../../shared/format-core'
import { dayLessons, type DayLesson } from '../../shared/edits-core'
import { isoFromDay, moscowNow, toMinutes } from '../../shared/schedule-core'
import { DIGEST_TIMES, chatLabel, forgetIfGone, inThread, isThreadError, loadChats, type ChatSettings } from './chats'
import { reportError } from './errors'
import { formatDay, formatLesson, formatWeek, loadTimetable, type BotTimetable } from './schedule'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

const WEEKLY_AT = 19 * 60 // суббота, 19:00 МСК
const LATE_WINDOW = 10 // cron опоздал — досылаем в течение 10 минут
const MAX_SENDS = 20 // за один запуск (лимит 50 подзапросов делим с рассылками)
const MAX_GROUPS = 15 // файлов групп за запуск сверки изменений (каждый — подзапрос к сайту)

type Slot = { id: string; chats: [string, ChatSettings][]; text: (tt: BotTimetable, group: string) => string | null }

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
          const lessons = dayLessons(tt, group, day, tt.extras).lessons
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

// Автосообщение в беседу — в её тему, если она задана. Тема удалена или закрыта — не пишем
// в General, а сообщаем владельцу; бота выгнали — забываем беседу.
async function deliver(env: Env, chatId: string, settings: ChatSettings, text: string, what: string): Promise<void> {
  try {
    await sendMessage(env, Number(chatId), text, inThread(settings.thread))
  } catch (err) {
    if (isThreadError(err)) {
      await reportError(env, `${what} не ушла в тему (удалена или закрыта?) — ${chatLabel(chatId, settings, settings.thread)}. Админ беседы может написать /here в нужной теме`, err)
    } else if (!(await forgetIfGone(env, Number(chatId), err))) {
      await reportError(env, `${what} — ${chatLabel(chatId, settings, settings.thread)}`, err)
    }
  }
}

// Утренние сводки и субботняя неделя. Возвращает число отправленных сообщений.
export async function runDigests(env: Env, now: number): Promise<number> {
  const { day, minutes } = moscowNow(new Date(now))
  const weekday = (((day - 4) % 7) + 7) % 7 // 1970-01-01 — четверг; 0 = понедельник
  const anyTimeDue = weekday <= 5 && [...DIGEST_TIMES.map(toMinutes), WEEKLY_AT].some((at) => minutes >= at && minutes < at + LATE_WINDOW)
  if (!anyTimeDue) return 0

  const slots = dueSlots(day, minutes, weekday, await loadChats(env)).filter((s) => s.chats.length)
  if (!slots.length) return 0
  // кому уже отправили сегодня — запоминаем, чтобы повторный запуск cron не продублировал;
  // за запуск — не больше MAX_SENDS бесед, и грузим расписание только их групп
  const plan: { slot: Slot; key: string; sent: Set<string>; todo: [string, ChatSettings][] }[] = []
  let budget = MAX_SENDS
  for (const slot of slots) {
    const key = `sent:${isoFromDay(day)}:${slot.id}`
    const sent = new Set((await env.KV.get<string[]>(key, 'json')) ?? [])
    const todo = slot.chats.filter(([chatId]) => !sent.has(chatId)).slice(0, budget)
    budget -= todo.length
    if (todo.length) plan.push({ slot, key, sent, todo })
  }
  if (!plan.length) return 0
  const tt = await loadTimetable(env, [...new Set(plan.flatMap((p) => p.todo.map(([, c]) => c.group!)))])
  let sends = 0
  for (const { slot, key, sent, todo } of plan) {
    for (const [chatId, settings] of todo) {
      sent.add(chatId)
      // нет файла группы (пропала из расписания ГУУ) — молчим
      const text = tt.schedule.groups.includes(settings.group!) ? slot.text(tt, settings.group!) : null
      if (!text) continue
      sends++
      await deliver(env, chatId, settings, text, 'Сводка')
    }
    await env.KV.put(key, JSON.stringify([...sent]), { expirationTtl: 3 * 86_400 })
  }
  return sends
}

// ---------- изменения в расписании ----------

type Snapshot = Record<string, string[]> // дата → пары строками

const lessonLine = (lesson: DayLesson) => formatLesson(lesson) // HTML, тот же вид, что в сводке

// Пары на 7 дней с правками (отменённые и перенесённые отсюда — не считаются): правка старосты
// тоже даёт «Изменение в расписании»
function snapshot(tt: BotTimetable, group: string, today: number): Snapshot {
  const result: Snapshot = {}
  for (let day = today; day < today + 7; day++) {
    result[isoFromDay(day)] = dayLessons(tt, group, day, tt.extras)
      .lessons.filter((l) => !l.cancel && !l.movedTo)
      .map(lessonLine)
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

// Раз в 10 минут: сверяем пары на неделю вперёд со снимком в D1 — для групп, у которых есть беседы
// с автосообщениями. Групп больше MAX_GROUPS — по кругу, разные части в разные запуски.
export async function detectChanges(env: Env, now: number): Promise<number> {
  const { day } = moscowNow(new Date(now))
  const chats = await loadChats(env)
  const all = [...new Set(Object.values(chats).filter((c) => c.group && c.time).map((c) => c.group!))].sort()
  if (!all.length) return 0
  const parts = Math.ceil(all.length / MAX_GROUPS)
  const part = Math.floor(now / 600_000) % parts
  const groups = all.slice(part * MAX_GROUPS, (part + 1) * MAX_GROUPS)

  const [tt, stored] = await Promise.all([
    loadTimetable(env, groups),
    env.DB.prepare('SELECT grp, data FROM group_snapshots WHERE grp IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(groups))
      .all<{ grp: string; data: string }>(),
  ])
  const previousOf = new Map(stored.results.map((r) => [r.grp, JSON.parse(r.data) as Snapshot]))
  const writes: D1PreparedStatement[] = []
  let sends = 0
  for (const group of groups) {
    if (!tt.schedule.groups.includes(group)) continue // файла группы нет — не считаем, что пары пропали
    const current = snapshot(tt, group, day)
    const previous = previousOf.get(group)
    if (previous && JSON.stringify(previous) === JSON.stringify(current)) continue
    // окно сдвинулось на день или пары поменялись
    writes.push(
      env.DB.prepare(
        'INSERT INTO group_snapshots (grp, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (grp) DO UPDATE SET data = ?2, updated_at = ?3',
      ).bind(group, JSON.stringify(current), now),
    )
    if (!previous) continue
    const blocks = describeChanges(previous, current)
    if (!blocks.length) continue

    const text = `⚠️ <b>Изменение в расписании</b> · ${escapeHtml(tt.nameOf(group))}\n\n${blocks.join('\n\n')}`.slice(0, 4000)
    for (const [chatId, settings] of Object.entries(chats)) {
      if (settings.group !== group || !settings.time || sends >= MAX_SENDS) continue
      sends++
      await deliver(env, chatId, settings, text, '«Изменение в расписании»')
    }
  }
  if (writes.length) await env.DB.batch(writes)
  return sends + groups.length
}
