// Запросы мини-приложения к боту (bot/): подписанный Telegram initData + данные.
// text/plain — «простой» запрос без CORS-предзапроса; воркер проверяет подпись сам.
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
