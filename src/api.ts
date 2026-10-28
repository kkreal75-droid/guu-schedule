// Запросы мини-приложения к боту (bot/): подписанный Telegram initData + данные.
// text/plain — «простой» запрос без CORS-предзапроса; воркер проверяет подпись сам.
import { t, tKnown } from './i18n'
import { BOT_URL, inTelegram, tg } from './telegram'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

// Можно ли вообще говорить с ботом: только внутри Telegram (нужна подпись) и если адрес известен
export const botAvailable = () => inTelegram && Boolean(BOT_URL)

export async function callBot<T>(path: string, payload: object = {}): Promise<T> {
  if (!botAvailable()) throw new ApiError(0, 'no-telegram')
  const res = await fetch(`${BOT_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify({ initData: tg!.initData, ...payload }),
  })
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`)
  return data
}

// Выбор из онбординга — боту (для /today, inline, рассылок). Вне Telegram — просто ничего.
export type ProfileChoice = { role: 'student'; group: string } | { role: 'teacher'; teacher: string }

// Выбранный язык — боту (на нём он пишет человеку: /start, /today, inline, календарь, рассылки)
export async function saveLang(lang: 'ru' | 'en'): Promise<void> {
  if (!botAvailable()) return
  await callBot('/lang', { lang })
}

// Избранное над расписанием (этап 12) — копия у бота для других устройств; at — когда менялось
export async function saveFavorites(list: string[], at: number): Promise<void> {
  if (!botAvailable()) return
  await callBot('/favorites', { list, at })
}

export async function saveProfile(choice: ProfileChoice): Promise<void> {
  if (!botAvailable()) return
  await callBot('/profile', choice)
}

// Ошибка от бота — человеку на языке интерфейса. Бот присылает готовые фразы по-русски (их перевод —
// в src/i18n/en.ts, раздел «ошибки бота»), иначе — код; неизвестное — общий текст.
export function botError(err: unknown, fallback?: string): string {
  if (!(err instanceof ApiError) || err.status === 0) return t('Нет связи. Попробуй ещё раз.')
  if (err.status === 429) return t('Слишком часто — подожди минуту.')
  if (err.code && /[а-яё]/i.test(err.code)) return tKnown(err.code) ?? fallback ?? t('Что-то сломалось 🛠')
  return fallback ?? t('Что-то сломалось 🛠')
}
