// Английская версия бота (этап 11): язык — выбранный в приложении или язык Telegram; приветствие, /today, inline,
// беседа, календарь и рассылка — на языке человека (беседы — на языке беседы), русская версия — как раньше.
import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { RU, type Locale } from '../src/i18n'
import { formatLesson, localizeLessonLine } from '../src/schedule'
import { splitLangs } from '../src/broadcast'
import type { Translations } from '../src/translations'
import mb11 from '../../public/data/schedule/b1-mb-mp-1.json'
import subjectsEn from '../../data/i18n/subjects.en.json'
import type { Lesson } from '../../shared/schedule-core'
import { OWNER, call, eventually, mockOutbound, newUser, postAs, sendUpdate, sql, telegramCalls } from './helpers'

beforeAll(() => mockOutbound())

let updateId = 990_000
type Sent = { method: string; body: { chat_id?: number; text?: string; reply_markup?: { inline_keyboard: { text: string }[][] }; results?: { title: string; reply_markup: { inline_keyboard: { text: string }[][] } }[] } }
const sentTo = (chat: number, method = 'sendMessage') =>
  (telegramCalls as Sent[]).filter((c) => c.method === method && c.body.chat_id === chat)

function privateMessage(id: number, text: string, lang?: string) {
  return sendUpdate({
    update_id: updateId++,
    message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'Alex', ...(lang ? { language_code: lang } : {}) }, text },
  })
}

const EN_LOC: Locale = { lang: 'en', names: { subject: subjectsEn as Record<string, string>, institute: {}, direction: {}, program: {} } as Translations }

describe('приветствие', () => {
  it('Telegram по-английски — английское приветствие и кнопка «📅 Open schedule»', async () => {
    const id = newUser()
    await privateMessage(id, '/start', 'en')
    const [msg] = await eventually(async () => sentTo(id).length && sentTo(id))
    expect(msg.body.text).toMatch(/what's up, bro|Hey Alex|Yo Alex/)
    expect(msg.body.reply_markup?.inline_keyboard[0][0].text).toBe('📅 Open schedule')
  })

  it('по-русски — как раньше; uk и kk — тоже по-русски', async () => {
    for (const code of ['ru', 'uk', 'kk', undefined]) {
      const id = newUser()
      await privateMessage(id, '/start', code)
      const [msg] = await eventually(async () => sentTo(id).length && sentTo(id))
      expect(msg.body.reply_markup?.inline_keyboard[0][0].text).toBe('📅 Открыть расписание')
    }
  })

  it('выбранный в приложении язык важнее языка Telegram', async () => {
    const id = newUser()
    await postAs(id, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    expect((await postAs(id, '/lang', { lang: 'en' })).status).toBe(200)
    await privateMessage(id, '/start', 'ru')
    const [msg] = await eventually(async () => sentTo(id).length && sentTo(id))
    expect(msg.body.reply_markup?.inline_keyboard[0][0].text).toBe('📅 Open schedule')
    expect((await sql('SELECT lang, lang_code FROM users WHERE id = ?', id).first())).toEqual({ lang: 'en', lang_code: 'ru' })
  })
})

describe('/today и inline', () => {
  it('/today по-английски: день недели и месяц по-английски, без «Пар нет»', async () => {
    const id = newUser()
    await postAs(id, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    await privateMessage(id, '/today', 'en')
    const [msg] = await eventually(async () => sentTo(id).length && sentTo(id))
    expect(msg.body.text).toMatch(/^📅 <b>(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{1,2} [A-Z][a-z]+<\/b>/)
    expect(msg.body.text).not.toMatch(/Пар нет|Вне учебного|выходной|неделя/)
  })

  it('inline: «tomorrow» и «завтра» понимаются оба, подпись — на языке человека', async () => {
    const en = newUser()
    const ru = newUser()
    for (const [id, lang, query] of [[en, 'en', 'tomorrow'], [ru, 'ru', 'завтра'], [en, 'en', 'завтра']] as const) {
      const before = telegramCalls.length
      await sendUpdate({ update_id: updateId++, inline_query: { id: `q${updateId}`, from: { id, first_name: 'A', language_code: lang }, query } })
      const answer = await eventually(async () => (telegramCalls.slice(before) as Sent[]).find((c) => c.method === 'answerInlineQuery'))
      const first = answer.body.results![0]
      expect(first.title.startsWith(lang === 'en' ? 'Tomorrow · ' : 'Завтра · ')).toBe(true)
      expect(first.reply_markup.inline_keyboard[0][0].text).toBe(lang === 'en' ? '📅 Open schedule' : '📅 Открыть расписание')
    }
  })
})

describe('пары по-английски', () => {
  const lessons = (mb11 as { lessons: Lesson[] }).lessons

  it('предмет из словаря, вид пары, ФИО латиницей, код аудитории — как есть', () => {
    const lesson = lessons.find((l) => (subjectsEn as Record<string, string>)[l.subject] && l.kind && l.teacher && l.room)!
    const line = formatLesson(lesson, EN_LOC)
    expect(line).toContain(`<b>${(subjectsEn as Record<string, string>)[lesson.subject]}</b>`)
    expect(line).toMatch(/\((Lecture|Seminar|Lab)\)/)
    expect(line).toContain(lesson.room!) // «У-349», «ЛК-405» — без перевода
    expect(line.replace(lesson.room!, '')).not.toMatch(/[А-Яа-яЁё]/)
    expect(formatLesson(lesson)).toBe(formatLesson(lesson, RU)) // русская строка не поменялась
  })

  it('снимок «Изменения в расписании» (по-русски) переводится так же, как пара по-английски', () => {
    for (const lesson of lessons) expect(localizeLessonLine(formatLesson(lesson), EN_LOC)).toBe(formatLesson(lesson, EN_LOC))
    expect(localizeLessonLine('09:00–10:30 · <b>Математика</b> · ЛК, 6 этаж', EN_LOC)).toBe('09:00–10:30 · <b>Mathematics</b> · ЛК, floor 6')
    // замены четвергов: преподаватель без инициалов; аудитория без номера
    expect(localizeLessonLine('09:00–10:30 · <b>Второй иностранный язык</b> (Практика) · ЛК-416 · Цаболова', EN_LOC)).toBe(
      '09:00–10:30 · <b>Second foreign language</b> (Seminar) · ЛК-416 · Tsabolova',
    )
    expect(localizeLessonLine('09:00–10:30 · <b>Математика</b> · Лунев', EN_LOC)).toBe('09:00–10:30 · <b>Mathematics</b> · Lunev')
    expect(localizeLessonLine('09:00–10:30 · <b>Математика</b> · Спортивный комплекс', EN_LOC)).toBe('09:00–10:30 · <b>Mathematics</b> · Sports complex')
  })
})

describe('календарь', () => {
  it('владелец ссылки по-английски — события по-английски, русское название в описании', async () => {
    const id = newUser()
    await postAs(id, '/profile', { role: 'student', group: 'b1-mb-mp-1' })
    await postAs(id, '/lang', { lang: 'en' })
    const { url } = (await (await postAs(id, '/cal/connect', { group: 'b1-mb-mp-1' })).json()) as { url: string }
    // строки длиннее 75 байт .ics переносит — склеиваем обратно
    const read = async () => (await (await call(new URL(url).pathname)).text()).replace(/\r\n /g, '')
    const ics = await read()
    const lesson = (mb11 as { lessons: Lesson[] }).lessons.find((l) => (subjectsEn as Record<string, string>)[l.subject])!
    const en = (subjectsEn as Record<string, string>)[lesson.subject]
    expect(ics).toContain(`SUMMARY:${en.replace(/,/g, '\\,')}`)
    expect(ics).toMatch(/X-WR-CALNAME:Schedule /)
    expect(ics).toMatch(/DESCRIPTION:(Lecture|Seminar|Lab)/)

    // вернул русский — календарь сразу по-русски (кэш ссылки сброшен)
    await postAs(id, '/lang', { lang: 'ru' })
    const ru = await read()
    expect(ru).toContain(`SUMMARY:${lesson.subject.replace(/,/g, '\\,')}`)
    expect(ru).toMatch(/X-WR-CALNAME:Расписание /)
  })
})

describe('беседа', () => {
  it('ещё не настроена — отвечает на языке того, кто пишет; настроена по-английски — по-английски', async () => {
    const chat = -100_990_001
    const from = newUser()
    const groupMessage = (text: string, lang: string) =>
      sendUpdate({
        update_id: updateId++,
        message: { message_id: 1, chat: { id: chat, type: 'supergroup', title: 'T' }, from: { id: from, first_name: 'A', language_code: lang }, text },
      })
    await groupMessage('/setup', 'en') // в тестах никто не админ
    await eventually(async () => sentTo(chat).some((c) => c.body.text === 'Only chat admins can set up the bot.'))

    const chats = (await env.KV.get<Record<string, unknown>>('chats', 'json')) ?? {}
    chats[String(chat)] = { title: 'T', group: 'b1-mb-mp-1', time: '07:30', lang: 'en', added_at: Date.now() }
    await env.KV.put('chats', JSON.stringify(chats))
    await groupMessage('/off', 'ru')
    await eventually(async () => sentTo(chat).some((c) => c.body.text === 'Only chat admins can turn the bot off.'))
  })
})

describe('рассылка RU / EN', () => {
  it('splitLangs: английский — после строки «/en»', () => {
    expect(splitLangs('Привет\n/en\nHello')).toEqual({ ru: 'Привет', en: 'Hello' })
    expect(splitLangs('<b>Привет</b>\n\n/en\n\n<b>Hello</b>')).toEqual({ ru: '<b>Привет</b>', en: '<b>Hello</b>' })
    expect(splitLangs('Только по-русски /en в тексте')).toEqual({ ru: 'Только по-русски /en в тексте', en: null })
  })

  it('английским — английский текст, остальным — русский; предпросмотр обоих', async () => {
    const [ru, en] = [newUser(), newUser()]
    await privateMessage(ru, '/start', 'ru')
    await privateMessage(en, '/start', 'en')
    await eventually(async () => sentTo(ru).length && sentTo(en).length)

    const before = sentTo(OWNER).length
    await privateMessage(OWNER, '/broadcast Привет всем\n/en\nHello everyone', 'ru')
    // предпросмотр: подсказка, русский вариант, английский с кнопками аудитории
    const previews = await eventually(async () => sentTo(OWNER).length >= before + 3 && sentTo(OWNER).slice(before))
    expect(previews.map((c) => c.body.text)).toEqual(expect.arrayContaining(['Привет всем', 'Hello everyone']))
    const id = (await sql('SELECT MAX(id) AS id FROM broadcasts').first<{ id: number }>())!.id
    expect(await sql('SELECT text, text_en FROM broadcasts WHERE id = ?', id).first()).toEqual({ text: 'Привет всем', text_en: 'Hello everyone' })

    await sendUpdate({
      update_id: updateId++,
      callback_query: { id: 'b', from: { id: OWNER, first_name: 'O' }, data: `bc:${id}:all`, message: { message_id: 1, chat: { id: OWNER, type: 'private' } } },
    })
    await eventually(async () => sentTo(en).some((c) => c.body.text === 'Hello everyone') && sentTo(ru).some((c) => c.body.text === 'Привет всем'))
  })
})
