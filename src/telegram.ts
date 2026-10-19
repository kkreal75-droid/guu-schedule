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

// Ссылки t.me открываем внутри Telegram (выбор беседы, бот и т. п.)
export function openTelegramLink(url: string) {
  if (supports('6.1')) tg!.openTelegramLink(url)
  else window.open(url, '_blank', 'noopener')
}

// Адрес бота (bot/). В dev — только если явно задан VITE_BOT_URL (локальный wrangler dev),
// чтобы локальная разработка не трогала настоящую статистику.
export const BOT_URL: string | null =
  import.meta.env.VITE_BOT_URL ?? (import.meta.env.DEV ? null : 'https://guu-schedule-bot.guu-schedule-bot.workers.dev')

// board — время последнего сообщения на каждой видимой доске (для точки «есть новое»)
export type CheckIn = { banned: boolean; admin: boolean; board: Record<string, number> }

// При открытии отправляем боту подписанный Telegram initData и выбранную группу
// (bot → POST /seen проверяет подпись, отмечает визит). В ответ — бан и права админа.
// text/plain — «простой» запрос без CORS-предзапроса. Ошибки и таймаут не мешают приложению.
export async function checkIn(timeoutMs = 2500): Promise<CheckIn | null> {
  if (!inTelegram || !BOT_URL) return null
  let group: string | null = null
  try {
    group = (JSON.parse(localStorage.getItem('prefs') ?? '{}') as { group?: string }).group ?? null
  } catch {
    // нет сохранённых настроек — группу не передаём
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BOT_URL}/seen`, {
      method: 'POST',
      body: JSON.stringify({ initData: tg!.initData, group }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<CheckIn>
    return { banned: Boolean(data.banned), admin: Boolean(data.admin), board: data.board ?? {} }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function telegramUser() {
  return inTelegram ? tg!.initDataUnsafe.user : undefined
}
