// Проверка подлинности: вебхук Telegram и initData мини-приложения.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import { safeEqual } from './guard'
import type { TgUser } from './telegram'

// initData старше суток не принимаем — меньше простора для повторной отправки чужих данных
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60
// часы клиента и Telegram могут расходиться — «из будущего» допускаем не больше 5 минут
const INIT_DATA_FUTURE_S = 5 * 60

// кто это: ник и имя из Telegram
// lang — language_code из Telegram (язык интерфейса Telegram у человека)
export type Profile = { id: number; username: string | null; name: string | null; lang?: string | null }

export const profileOf = (user: TgUser): Profile => ({
  id: user.id,
  username: user.username || null,
  name: [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 64) || null,
  lang: typeof user.language_code === 'string' ? user.language_code.slice(0, 16) : null,
})

export const isOwner = (env: Env, userId: number | undefined) =>
  userId !== undefined && Boolean(env.OWNER_ID) && String(userId) === env.OWNER_ID.trim()

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

// Ключ вебхука: Telegram кладёт его в заголовок каждого запроса — выводим из токена бота
export async function webhookSecret(env: Env): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`webhook:${env.BOT_TOKEN}`)))
}

// Возвращает пользователя, если initData подписан нашим ботом и не старше суток; иначе null
export async function verifyInitData(initData: string, env: Env): Promise<Profile | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  const secret = await hmac(new TextEncoder().encode('WebAppData'), env.BOT_TOKEN)
  const dataCheck = (skip: string[]) =>
    [...params.entries()]
      .filter(([key]) => !skip.includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n')
  // поле signature (для сторонней проверки) клиенты присылают не всегда; в строку для hash
  // по документации оно входит, но на случай расхождений проверяем оба варианта
  let valid = false
  for (const candidate of [dataCheck(['hash']), dataCheck(['hash', 'signature'])]) {
    if (safeEqual(toHex(await hmac(secret, candidate)), hash)) valid = true
  }
  if (!valid) return null

  const authDate = Number(params.get('auth_date'))
  const age = Date.now() / 1000 - authDate
  if (!authDate || age > INIT_DATA_MAX_AGE_S || age < -INIT_DATA_FUTURE_S) return null
  try {
    const user = JSON.parse(params.get('user') ?? '') as Partial<TgUser>
    return typeof user.id === 'number' ? profileOf(user as TgUser) : null
  } catch {
    return null
  }
}
