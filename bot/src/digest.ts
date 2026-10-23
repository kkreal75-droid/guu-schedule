// Автосообщения в беседы (cron раз в минуту):
//   • в учебные дни (Пн–Сб) в выбранное время — пары на сегодня или «Сегодня пар нет 🎉»; в первый день
//     каникул по учебному графику — «🎉 Каникулы! Пар нет до ДД.ММ» (academic.ts); в день «Проектного обучения» —
//     строка «Сегодня проектное обучение — N мероприятий» (events.ts, make.events);
//   • в субботу в 19:00 — неделя вперёд;
//   • раз в 10 минут — сверка пар на 7 дней вперёд; изменились — «⚠️ Изменение в расписании».
// Расписание и настройки читаем только в те минуты, когда есть что делать, и только для групп,
// к которым привязаны беседы. Снимки «пары на 7 дней» — в D1 (group_snapshots): групп много,
// а у KV всего 1000 записей в сутки.
import { dayLessons, type DayLesson } from '../../shared/edits-core'
import { isoFromDay, moscowNow, toMinutes } from '../../shared/schedule-core'
import { DIGEST_TIMES, chatLabel, forgetIfGone, inThread, isThreadError, loadChats, type ChatSettings } from './chats'
import { holidayEnds } from './academic'
import { loadEvents, projectLine } from './events'
import { isProjectLesson } from '../../shared/events-core'
import { reportError } from './errors'
import { RU, localeFor, tr, type Locale } from './i18n'
import { dayTitle, formatDay, formatLesson, formatWeek, loadTimetable, localizeLessonLine, type BotTimetable } from './schedule'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

const WEEKLY_AT = 19 * 60 // суббота, 19:00 МСК
const LATE_WINDOW = 10 // cron опоздал — досылаем в течение 10 минут
const MAX_SENDS = 20 // за один запуск (лимит 50 подзапросов делим с рассылками)
const MAX_GROUPS = 15 // файлов групп за запуск сверки изменений (каждый — подзапрос к сайту)

// text — на языке беседы (loc)
type Slot = { id: string; chats: [string, ChatSettings][]; text: (tt: BotTimetable, group: string, loc: Locale) => string | null }

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
        text: (tt, group, loc) => {
          if (!tt.inSemester(tt.weekOf(day))) return null // каникулы — молчим
          const lessons = dayLessons(tt, group, day, tt.extras).lessons
          return lessons.length
            ? `☀️ ${formatDay(tt, day, group, null, loc)}`
            : `☀️ <b>${dayTitle(loc, weekday, day)}</b> · ${escapeHtml(group)}\n${tr(loc.lang, 'Сегодня пар нет 🎉')}`
        },
      })
    }
  }
  if (weekday === 5 && inWindow(WEEKLY_AT)) {
    slots.push({
      id: 'weekly',
      chats: enabled,
      text: (tt, group, loc) => (tt.inSemester(tt.weekOf(day + 2)) ? formatWeek(tt, day + 2, group, null, loc) : null),
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
  const groups = [...new Set(plan.flatMap((p) => p.todo.map(([, c]) => c.group!)))]
  // английские беседы — с переводом названий (словари с сайта, кэш 10 минут)
  const english = plan.some((p) => p.todo.some(([, c]) => c.lang === 'en'))
  const [tt, en] = await Promise.all([loadTimetable(env, groups), english ? localeFor(env, 'en') : RU])
  // первый день каникул по учебному графику — вместо пар «🎉 Каникулы! Пар нет до ДД.ММ»
  const daily = plan.some((p) => p.slot.id.startsWith('daily-'))
  const holidays = daily
    ? await holidayEnds(env, groups, day).catch((err) => (reportError(env, 'Учебный график в сводке', err), new Map<string, string>()))
    : new Map<string, string>()
  // у группы сегодня «Проектное обучение» — в сводке строка «Сегодня проектное обучение — N мероприятий» (make.events)
  const project = daily && groups.some((g) => tt.schedule.groups.includes(g) && dayLessons(tt, g, day, tt.extras).lessons.some(isProjectLesson))
  const events = project ? await loadEvents(env).catch((err) => (reportError(env, 'Мероприятия в сводке', err), null)) : null
  let sends = 0
  for (const { slot, key, sent, todo } of plan) {
    for (const [chatId, settings] of todo) {
      sent.add(chatId)
      // нет файла группы (пропала из расписания ГУУ) — молчим
      const loc = settings.lang === 'en' ? en : RU
      const holidayEnd = slot.id.startsWith('daily-') ? holidays.get(settings.group!) : undefined
      const holiday = holidayEnd ? tr(loc.lang, '🎉 Каникулы! Пар нет до {date}', { date: holidayEnd }) : null
      let text = holiday ?? (tt.schedule.groups.includes(settings.group!) ? slot.text(tt, settings.group!, loc) : null)
      if (!text) continue
      const extra = !holiday && slot.id.startsWith('daily-') ? projectLine(tt, settings.group!, day, events, loc) : null
      if (extra) text += `\n\n${extra}`
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

// строки снимков — по-русски (так они хранятся в D1); для английской беседы — переводим
function describeChanges(previous: Snapshot, current: Snapshot, loc: Locale): string[] {
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
    const line = (l: string) => localizeLessonLine(l, loc)
    blocks.push(
      [
        `<b>${dayTitle(loc, weekday, day)}</b>`,
        ...removed.map((l) => `❌ ${tr(loc.lang, 'было:')} ${line(l)}`),
        ...added.map((l) => `✅ ${tr(loc.lang, 'стало:')} ${line(l)}`),
        ...(lessons.length ? [] : [tr(loc.lang, 'Теперь в этот день пар нет 🎉')]),
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
    if (!describeChanges(previous, current, RU).length) continue

    // текст — на языке беседы (английский — только если есть такие беседы)
    const texts = new Map<string, string>()
    const textIn = async (lang: 'ru' | 'en') => {
      let text = texts.get(lang)
      if (text === undefined) {
        const loc = lang === 'en' ? await localeFor(env, 'en') : RU
        const blocks = describeChanges(previous, current, loc)
        text = `⚠️ <b>${tr(lang, 'Изменение в расписании')}</b> · ${escapeHtml(tt.nameOf(group))}\n\n${blocks.join('\n\n')}`.slice(0, 4000)
        texts.set(lang, text)
      }
      return text
    }
    for (const [chatId, settings] of Object.entries(chats)) {
      if (settings.group !== group || !settings.time || sends >= MAX_SENDS) continue
      sends++
      await deliver(env, chatId, settings, await textIn(settings.lang ?? 'ru'), '«Изменение в расписании»')
    }
  }
  if (writes.length) await env.DB.batch(writes)
  return sends + groups.length
}
