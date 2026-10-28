// Язык интерфейса (этап 11): русский — основной, английский — перевод. Строки пишем по-русски прямо в коде
// через t('…') — русский текст и есть ключ; английский — в src/i18n/en.ts. Плюрализация — tn(n, 'пара|пары|пар')
// (по-английски — 'class|classes'). Нет перевода — останется русский: это ловит scripts/i18n_check.mjs.
// Язык меняется без перезагрузки: useLang() подписывает компонент (App и корень — значит, всё дерево).
// Данные ГУУ (группы, аудитории, оригинальные названия) в разметке помечаем lang="ru".
import { useSyncExternalStore } from 'react'
import { pluralForm, type Lang } from '../shared/i18n-core'
import { EN } from './i18n/en'

export type { Lang } from '../shared/i18n-core'

let current: Lang = 'ru'
let revision = 0 // меняется при смене языка и когда загрузились переводы данных ГУУ — подписчики перерисуются
const listeners = new Set<() => void>()

export const getLang = () => current

export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  document.documentElement.lang = lang
  refresh()
}

// перерисовать всё (загрузились переводы названий предметов, программ, мест)
export function refresh() {
  revision++
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

const getRevision = () => revision
export const useLang = (): Lang => {
  useSyncExternalStore(subscribe, getRevision, getRevision)
  return current
}

type Params = Record<string, string | number>
const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match)) : text

// t('Расписание') → «Schedule»; t('Неделя {n}', { n: 8 }) → «Week 8». После «#» — контекст для перевода
// (одна русская строка — разные английские): t('Вернуть#скрытая пара') по-русски — «Вернуть»
const plain = (key: string) => key.split('#')[0]

export function t(ru: string, params?: Params): string {
  return fill(current === 'en' ? (EN[ru] ?? plain(ru)) : plain(ru), params)
}

// tn(3, 'пара|пары|пар') → «пары» / «classes»; {n} в формах — само число
export function tn(n: number, forms: string, params?: Params): string {
  return fill(pluralForm(current, n, current === 'en' ? (EN[forms] ?? plain(forms)) : plain(forms)), { n, ...params })
}

// Готовая русская фраза не из кода (ошибка от бота): перевод из словаря, если он есть; нет — null
export function tKnown(ru: string): string | null {
  return current === 'en' ? (EN[ru] ?? null) : ru
}
