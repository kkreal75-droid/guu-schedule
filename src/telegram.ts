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

export function openLink(url: string) {
  if (inTelegram) tg!.openLink(url)
  else window.open(url, '_blank', 'noopener')
}

// Бот считает, сколько людей открывали приложение: отправляем ему подписанный Telegram
// initData (bot/src/index.ts → POST /seen проверяет подпись). Режим no-cors и text/plain —
// «простой» запрос без CORS-настроек; ответ не нужен, ошибки не мешают приложению.
const SEEN_URL = 'https://guu-schedule-bot.guu-schedule-bot.workers.dev/seen'

export function reportOpen() {
  if (!inTelegram || import.meta.env.DEV) return
  fetch(SEEN_URL, { method: 'POST', mode: 'no-cors', body: tg!.initData, keepalive: true }).catch(() => {})
}

export function telegramUser() {
  return inTelegram ? tg!.initDataUnsafe.user : undefined
}
