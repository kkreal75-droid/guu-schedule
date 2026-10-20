import type { ScheduleEdit, Subgroup } from './edits'
import type { LessonTag } from '../shared/edits-core'
import { groupsToLoad } from './schedule'
import { readPrefs } from './prefs'

// Обёртка над window.Telegram.WebApp (скрипт подключён в index.html).
// Вне Telegram объект тоже существует, но initData пустой и версия 6.0 —
// поэтому все вызовы новых методов проверяем через supports().

export type WebApp = Window['Telegram']['WebApp']

export const tg: WebApp | undefined = window.Telegram?.WebApp
export const inTelegram = Boolean(tg?.initData)

export const supports = (version: string) => inTelegram && Boolean(tg?.isVersionAtLeast(version))

export function initTelegram() {
  if (!tg || !inTelegram) return
  tg.ready()
  tg.expand()
  // иначе свайп вниз по длинному списку пар закрывает приложение
  if (supports('7.7')) tg.disableVerticalSwipes()
}

export function haptic(kind: 'select' | 'light' = 'select') {
  if (!supports('6.1')) return
  if (kind === 'select') tg!.HapticFeedback.selectionChanged()
  else tg!.HapticFeedback.impactOccurred('light')
}

// Telegram открывает только http(s); другие схемы (webcal: и т. п.) — обычным переходом
export function openLink(url: string) {
  if (inTelegram && /^https?:/i.test(url)) tg!.openLink(url)
  else if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener')
  else window.location.href = url
}

// Подтверждение в стиле Telegram (вне Telegram — обычный confirm)
export function confirmAction(message: string): Promise<boolean> {
  if (supports('6.2')) return new Promise((resolve) => tg!.showConfirm(message, resolve))
  return Promise.resolve(window.confirm(message))
}

// Короткое сообщение в стиле Telegram (вне Telegram — обычный alert)
export function showAlert(message: string) {
  if (supports('6.2')) tg!.showAlert(message)
  else window.alert(message)
}

// Ссылки t.me открываем внутри Telegram (выбор беседы, бот и т. п.)
export function openTelegramLink(url: string) {
  if (supports('6.1')) tg!.openTelegramLink(url)
  else window.open(url, '_blank', 'noopener')
}

// Адрес бота (bot/). В dev — только если явно задан VITE_BOT_URL (локальный wrangler dev),
// чтобы локальная разработка не трогала настоящую статистику.
export const BOT_URL: string | null =
  import.meta.env.VITE_BOT_URL ?? (import.meta.env.DEV ? null : 'https://guu-schedule-bot.guu-schedule-bot.workers.dev')

// Что бот знает о человеке: выбор из онбординга (на случай, если на этом устройстве его нет)
// и нужен ли онбординг (новый пользователь)
export type Me = {
  role: 'student' | 'teacher' | null
  group: string | null
  teacher: string | null
  access: 'free_forever' | 'standard' // будущая оплата: только структура, сейчас всё бесплатно
  onboarding: boolean
  starosta: string | null // староста этой группы — «Ещё → Правки группы»
  intro: number // какую версию знакомства уже видел (этап 7.1)
}

// edits — ручные правки расписания; notice — объявление-плашка; maintenance — текст техработ
export type CheckIn = {
  banned: boolean
  admin: boolean
  me: Me | null
  edits: ScheduleEdit[]
  subgroups: Subgroup[]
  tags: LessonTag[]
  notice: { id: number; text: string } | null
  maintenance: string | null
  channel: string | null // «Другое → Канал новостей» (ссылка из админки)
}

// При открытии отправляем боту подписанный Telegram initData и выбранную группу
// (bot → POST /seen проверяет подпись, отмечает визит). В ответ — бан и права админа.
// text/plain — «простой» запрос без CORS-предзапроса. Ошибки и таймаут не мешают приложению.
export async function checkIn(timeoutMs = 2500): Promise<CheckIn | null> {
  if (!inTelegram || !BOT_URL) return null
  let group: string | null = null
  let groups: string[] = []
  try {
    const prefs = JSON.parse(localStorage.getItem('prefs') ?? '{}') as { group?: string; role?: string }
    // у преподавателя группы нет (в настройках — значение по умолчанию), не передаём
    group = prefs.role === 'teacher' ? null : (prefs.group ?? null)
    // правки и подгруппы — только групп на экране (своя, избранные)
    if (prefs.group || prefs.role) groups = groupsToLoad(readPrefs()).filter((g) => !g.startsWith('t-'))
  } catch {
    // нет сохранённых настроек — группу не передаём
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BOT_URL}/seen`, {
      method: 'POST',
      // v: 2 — группа и правки по id («b1-mb-mp-1»), а не по имени
      body: JSON.stringify({ initData: tg!.initData, group, groups: groups.length ? groups : undefined, v: 2 }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<CheckIn>
    return {
      banned: Boolean(data.banned),
      admin: Boolean(data.admin),
      me: data.me ?? null,
      edits: Array.isArray(data.edits) ? data.edits : [],
      subgroups: Array.isArray(data.subgroups) ? data.subgroups : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      notice: data.notice ?? null,
      maintenance: data.maintenance ?? null,
      channel: typeof data.channel === 'string' ? data.channel : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function telegramUser() {
  return inTelegram ? tg!.initDataUnsafe.user : undefined
}
