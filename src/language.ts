// Язык интерфейса человека (этап 11). Выбранный хранится на устройстве и в облаке Telegram (ключ lang) и у бота
// (D1 users.lang — на нём бот пишет человеку). Не выбирал — язык Telegram (ru / uk / be / kk → русский).
import { isLang, type Lang } from '../shared/i18n-core'
import { saveLang } from './api'
import { setLang } from './i18n'
import { readLocal, save, writeLocal } from './storage'
import { telegramLang } from './telegram'

const KEY = 'lang'

export function savedLang(): Lang | null {
  const value = readLocal(KEY)
  return isLang(value) ? value : null
}

// При запуске: своё на устройстве → в облаке Telegram → у бота → язык Telegram
export function bootLang(cloud: string | null, bot: Lang | null | undefined): Lang {
  const local = savedLang()
  if (local) return local
  const known = isLang(cloud) ? cloud : isLang(bot) ? bot : null
  if (known) writeLocal(KEY, known)
  return known ?? telegramLang()
}

// Выбор в знакомстве или «Профиль → Язык»: интерфейс меняется сразу, без перезагрузки
export function chooseLang(lang: Lang) {
  setLang(lang)
  save(KEY, lang)
  saveLang(lang).catch((err) => console.warn('Не удалось сохранить язык в боте', err))
}
