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

export function telegramUser() {
  return inTelegram ? tg!.initDataUnsafe.user : undefined
}
