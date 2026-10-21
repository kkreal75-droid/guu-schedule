// Языки — общее для приложения и бота. Русский — основной, английский — перевод (этап 11).
// Даты и дни недели — через Intl (ru-RU / en-GB), плюрализация — Intl.PluralRules.
import { DAY_MS } from './schedule-core'

export type Lang = 'ru' | 'en'
export const LANGS: readonly Lang[] = ['ru', 'en']
export const isLang = (value: unknown): value is Lang => value === 'ru' || value === 'en'

// Язык по настройке Telegram (language_code): ru / uk / be / kk → русский, остальные → английский;
// неизвестно — русский (основной)
const RU_FAMILY = new Set(['ru', 'uk', 'be', 'kk'])
export function langFromCode(code: string | null | undefined): Lang {
  if (!code) return 'ru'
  return RU_FAMILY.has(code.toLowerCase().split(/[-_]/)[0]) ? 'ru' : 'en'
}

// Выбранный язык, а если не выбран — по Telegram
export const effectiveLang = (chosen: unknown, code?: string | null): Lang => (isLang(chosen) ? chosen : langFromCode(code))

export const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB' }

// ---------- плюрализация ----------

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {}

// forms: ru — «пара|пары|пар» (одна, несколько, много), en — «class|classes» (one, other).
// {n} внутри формы заменяется числом: «до сессии {n} день|…»
export function pluralForm(lang: Lang, n: number, forms: string): string {
  const list = forms.split('|')
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(LOCALE[lang]))
  const rule = rules.select(n)
  const index = lang === 'ru' ? (rule === 'one' ? 0 : rule === 'few' ? 1 : 2) : rule === 'one' ? 0 : 1
  return (list[Math.min(index, list.length - 1)] ?? list[0]).replace(/\{n\}/g, String(n))
}

// ---------- даты ----------
// День — номер дня от 1970-01-01 (UTC), как в schedule-core; форматируем в UTC, чтобы не сдвигалось

const formats = new Map<string, Intl.DateTimeFormat>()
function format(lang: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(options)}`
  let f = formats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', ...options })
    formats.set(key, f)
  }
  return f
}
const dateOfDay = (day: number) => new Date(day * DAY_MS)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// «21 октября» / «21 October»
export const dayMonth = (day: number, lang: Lang) => format(lang, { day: 'numeric', month: 'long' }).format(dateOfDay(day))

// «21 октября 2026» / «21 October 2026»
export const dayMonthYear = (day: number, lang: Lang) =>
  format(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(dateOfDay(day)).replace(/\s*г\.$/, '')

// «19 окт» / «19 Oct»
export const dayMonthShort = (day: number, lang: Lang) =>
  format(lang, { day: 'numeric', month: 'short' }).format(dateOfDay(day)).replace(/\.$/, '')

// «Октябрь» / «October» (месяц сам по себе)
export const monthName = (month: number, lang: Lang) => capitalize(format(lang, { month: 'long' }).format(new Date(Date.UTC(2026, month, 1))))

// день недели по номеру (0 = понедельник): «Среда» / «Wednesday», коротко «Ср» / «Wed»
const MONDAY = 4 // 1970-01-05 — понедельник
export const weekdayName = (weekday: number, lang: Lang, style: 'long' | 'short' = 'long') =>
  capitalize(format(lang, { weekday: style }).format(dateOfDay(MONDAY + weekday))).replace(/\.$/, '')
