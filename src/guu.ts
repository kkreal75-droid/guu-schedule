// Данные ГУУ на языке интерфейса (этап 11). Сами данные (группы, предметы, программы) — по-русски, как в файлах
// guu.ru. По-английски: предметы — data/i18n/subjects.en.json, институты, направления, программы —
// data/i18n/guu.en.json, правки владельца — у бота (GET /translations, админ-панель → «Переводы»); виды пар — из
// словаря интерфейса, ФИО — латиницей (ICAO), корпус аудитории — английское название из «Корпусов ГУУ».
// Словари грузятся, только когда язык английский; пока не загрузились — по-русски.
import type { GroupInfo } from '../shared/groups'
import { translit } from '../shared/i18n-core'
import { cachedList } from './data'
import { getLang, refresh, t, tKnown } from './i18n'
import { loadPlaces, placeForRoom, type Place } from './places'
import { readLocal, writeLocal } from './storage'
import { BOT_URL } from './telegram'

type Kind = 'subject' | 'institute' | 'direction' | 'program'
type Names = { institutes: Record<string, string>; directions: Record<string, string>; programs: Record<string, string> }
type Edit = { kind: Kind; ru: string; en: string }

const loadSubjects = cachedList<Record<string, string>>('i18n/subjects.en.json', 'i18n_subjects')
const loadNames = cachedList<Names>('i18n/guu.en.json', 'i18n_names')

const EDITS_KEY = 'i18n_edits'
let fresh = false
async function loadEdits(): Promise<Edit[]> {
  let saved: Edit[] = []
  try {
    saved = JSON.parse(readLocal(EDITS_KEY) ?? '[]') as Edit[]
  } catch {
    saved = []
  }
  if (!BOT_URL) return saved
  try {
    const res = await fetch(`${BOT_URL}/translations`, fresh ? { cache: 'no-store' } : {})
    fresh = false
    if (!res.ok) return saved
    const data = (await res.json()) as { edits: Edit[] }
    writeLocal(EDITS_KEY, JSON.stringify(data.edits))
    return data.edits
  } catch {
    return saved
  }
}

let dict: Record<Kind, Record<string, string>> = { subject: {}, institute: {}, direction: {}, program: {} }
let places: Place[] = []
let promise: Promise<void> | null = null

// Словари для английского; загрузились — перерисовать всё
export function loadEnglishNames(): Promise<void> {
  return (promise ??= Promise.all([loadSubjects(), loadNames(), loadEdits(), loadPlaces().catch(() => [] as Place[])])
    .then(([subjects, names, edits, list]) => {
      dict = { subject: { ...subjects }, institute: { ...names.institutes }, direction: { ...names.directions }, program: { ...names.programs } }
      for (const e of edits) if (e.kind in dict) dict[e.kind][e.ru] = e.en
      places = list
      refresh()
    })
    .catch((err) => {
      promise = null
      console.warn('Переводы названий ГУУ не загрузились', err)
    }))
}

// владелец поправил перевод в админке — перечитать
export function forgetTranslations() {
  promise = null
  fresh = true
}

const en = () => getLang() === 'en'

// «История России» → «History of Russia»; перевода нет — как в файле
export const trSubject = (ru: string) => (en() ? (dict.subject[ru] ?? ru) : ru)
export const trProgram = (ru: string) => (en() ? (dict.program[ru] ?? dict.direction[ru] ?? ru) : ru)
export const trDirection = (ru: string) => (en() ? (dict.direction[ru] ?? ru) : ru)
// институт: по-русски — полное название из groups.json (если есть), по-английски — из словаря
export const trInstitute = (abbr: string, full?: string) => (en() ? (dict.institute[abbr] ?? full ?? abbr) : (full ?? abbr))
// «Лекция / Практика / Лабораторная» → Lecture / Seminar / Lab (словарь интерфейса)
export const trKind = (kind: string | null) => (kind && en() ? (tKnown(kind) ?? kind) : kind)
// «Крюкова Е.В.» → «Kriukova E.V.»
export const trTeacher = (name: string) => (en() ? translit(name) : name)

// Аудитория на языке интерфейса: по-русски — как в файле; по-английски код — как есть, этаж — «floor»,
// корпус — английское название из «Корпусов ГУУ» («ЛК-405 · Laboratory building»); место целиком
// («Спортивный комплекс») — только английским названием, зал в корпусе — «Assembly hall · Lecture hall building».
// code: null — код не показывать
export function roomLabel(room: string): { code: string | null; building: string | null } {
  if (!en()) return { code: room, building: null }
  const floor = room.match(/^(.+), (\d+) этаж$/) // i18n-ignore — формат места из update.py
  const place = places.length ? placeForRoom(places, room) : null
  const building = place?.name_en ?? null
  if (!/\d/.test(room) && building) {
    const hall = place!.name.toLowerCase() === room.trim().toLowerCase() ? null : tKnown(room)
    return { code: null, building: hall ? `${hall} · ${building}` : building }
  }
  return { code: floor ? `${floor[1]}, floor ${floor[2]}` : room, building }
}

// «Международный бизнес · ИУПСиБК · 1 курс» / «International Business · ИУПСиБК · Year 1». Аббревиатура института —
// как в файлах ГУУ; не аббревиатура («Аспирантура») — по-английски
const instituteShort = (abbr: string) => (en() && abbr.length > 8 ? trInstitute(abbr) : abbr)
// [программа, институт, курс] — институт в разметке помечают lang="ru", если он остался по-русски
export const groupSubtitleParts = (g: GroupInfo): [string, string, string] => [
  trProgram(g.program),
  instituteShort(g.institute),
  g.level === 'postgrad' ? t('аспирантура, {n} курс', { n: g.course }) : t('{n} курс', { n: g.course }),
]

// что на странице сессии guu.ru (session_status.json): «зимняя сессия 2026/27», «весенняя сессия прошлого года»
// i18n-ignore — разбираем русскую подпись update.py
const SEASONS: Record<string, string> = { зимняя: 'winter', летняя: 'summer', весенняя: 'spring', осенняя: 'autumn', текущая: 'current' } // i18n-ignore
export function sessionPageText(label: string): string {
  if (!en()) return label
  const m = label.match(/^(.*?)\s*сессия\s*(.*)$/) // i18n-ignore
  if (!m) return label
  const seasons = m[1].split(/\s+и\s+/).map((s) => SEASONS[s.trim()] ?? s).filter(Boolean).join(' and ') // i18n-ignore
  const when = m[2] === 'прошлого года' ? t('прошлого года') : m[2] // i18n-ignore
  return `${seasons ? `${seasons} ` : ''}${t('сессия#страница guu.ru')} ${when}`.trim()
}
