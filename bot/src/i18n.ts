// Английская версия бота (этап 11). Русская строка в коде — она же ключ: tr(lang, 'Пар нет 🎉') → «No classes 🎉»;
// перевод — bot/src/i18n-en.ts, нет перевода — по-русски. Что у каждой строки tr()/trn() есть перевод,
// проверяет npm run i18n (scripts/i18n_check.mjs).
// Язык человека — выбранный в приложении (users.lang), а если не выбран — язык Telegram (language_code).
// Язык беседы — настройка /setup (ChatSettings.lang). Сообщения владельцу (ошибки, отчёты, админские
// команды) — только по-русски.
import { effectiveLang, pluralForm, translit, type Lang } from '../../shared/i18n-core'
import { EN } from './i18n-en'
import { loadTranslations, type Translations } from './translations'

export type { Lang }

export function tr(lang: Lang, ru: string, params?: Record<string, string | number>): string {
  const text = lang === 'en' ? (EN[ru] ?? ru) : ru
  return params ? text.replace(/\{(\w+)\}/g, (m: string, key: string) => (key in params ? String(params[key]) : m)) : text
}

// перевод данных, которые приходят не из кода (вид пары «Лекция»): нет в словаре — как есть
export const trKnown = (lang: Lang, ru: string) => (lang === 'en' ? (EN[ru] ?? ru) : ru)

// формы по числу: «пара|пары|пар» → «class|classes»; {n} внутри формы — само число
export const trn = (lang: Lang, n: number, forms: string) => pluralForm(lang, n, lang === 'en' ? (EN[forms] ?? forms) : forms)

// Язык человека: выбранный в приложении, иначе — из Telegram (code из обновления свежее сохранённого)
export const langOf = (user: { lang?: string | null; lang_code?: string | null } | null | undefined, code?: string | null): Lang =>
  effectiveLang(user?.lang, code ?? user?.lang_code)

// ---------- данные ГУУ на языке сообщения ----------
// Предметы — словари с сайта и правки владельца (translations.ts), виды пар — словарь бота, ФИО — латиницей (ICAO),
// код аудитории — как есть. Сами данные остаются русскими: перевода нет — как в файле ГУУ.

export type Locale = { lang: Lang; names: Translations | null }
export const RU: Locale = { lang: 'ru', names: null }

export const localeFor = async (env: Env, lang: Lang): Promise<Locale> =>
  lang === 'en' ? { lang, names: await loadTranslations(env).catch(() => null) } : RU

export const subjectIn = (loc: Locale, ru: string) => (loc.lang === 'en' ? (loc.names?.subject[ru] ?? ru) : ru)
export const kindIn = (loc: Locale, kind: string) => trKnown(loc.lang, kind)
// преподаватели — латиницей; у преподавателя на месте преподавателя — группы («МБ(МП) 1-1», в имени всегда есть
// цифры), их не трогаем
export const peopleIn = (loc: Locale, text: string) => (loc.lang === 'en' && !/\d/.test(text) ? translit(text) : text)
// «ЛК, 6 этаж» (место из update.py) → «ЛК, floor 6»; «Спортивный комплекс» → «Sports complex»; код — как есть
export const roomIn = (loc: Locale, room: string) =>
  loc.lang === 'en' ? trKnown('en', room).replace(/^(.+), (\d+) этаж$/, '$1, floor $2') : room

// «Крюкова Е.В.», «Цаболова», «Лунев, Иванов И.И.» — похоже на преподавателей (для строк без разметки)
const NAME = '[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:\\s+[А-ЯЁ]\\.\\s?(?:[А-ЯЁ]\\.)?)?'
const NAMES = new RegExp(`^${NAME}(?:,\\s*${NAME})*$`)
export const looksLikeNames = (text: string) => NAMES.test(text)
