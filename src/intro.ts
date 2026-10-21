// Знакомство (истории автора → подтверждение группы → тур) — всем один раз (этап 7.1). Что человек уже
// видел — в localStorage, CloudStorage Telegram ('intro') и у бота (users.intro_version): берём наибольшее,
// так что на новом устройстве знакомство не повторится. Владелец может сбросить себе в админке.
import { botAvailable, callBot } from './api'
import { cloudRemove, cloudSet, readLocal, writeLocal } from './storage'

export const INTRO_VERSION = 2
const KEY = 'intro'

const num = (value: string | number | null | undefined) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export const introSeen = (cloud: string | null, bot: number | null | undefined) =>
  Math.max(num(readLocal(KEY)), num(cloud), num(bot))

export function markIntroDone() {
  writeLocal(KEY, String(INTRO_VERSION))
  void cloudSet(KEY, String(INTRO_VERSION))
  if (botAvailable()) callBot('/intro', { version: INTRO_VERSION }).catch(() => {})
}

// «Сбросить мой онбординг» (админка): всё обнулить (и выбранный язык — знакомство начнётся с него)
// и перезапустить приложение
export async function resetIntro() {
  await callBot('/admin/reset-intro')
  writeLocal(KEY, '0')
  writeLocal('lang', '')
  await Promise.all([cloudSet(KEY, '0'), cloudRemove('lang')])
}
