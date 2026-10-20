// «Спорт» (этап 7.4): секции и их занятия. Машиночитаемого расписания секций на guu.ru нет — его ведёт
// владелец в админке (вручную или импортом CSV / xlsx, разбор файла — в приложении).
//   GET /sport — всем (данные публичные), кэш 60 с;
//   POST /admin/sport-* — только OWNER_ID (проверку делает handleAdminApi).
// Импорт пишет одним-тремя запросами через json_each — бесплатный тариф D1 ограничивает число запросов.
import { normalizeWeeks, weeksProblem, type SportData } from '../../shared/sport-core'
import { CORS, json } from './api'

const TIME = /^\d{2}:\d{2}$/
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const asInt = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const fail = (error: string) => json({ ok: false, error }, 400)

// «9:00» → «09:00»
export const normTime = (v: unknown) => {
  const m = clip(v, 8).match(/^(\d{1,2})[:.](\d{2})$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

export async function loadSport(env: Env): Promise<SportData> {
  const [sections, sessions] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, emoji, teacher, place, place_id, about, sort, updated_at FROM sport_sections ORDER BY sort, name'),
    env.DB.prepare('SELECT id, section_id, weekday, start, end, weeks, teacher, place, updated_at FROM sport_sessions ORDER BY weekday, start'),
  ])
  const all = [...(sections.results as { updated_at: number }[]), ...(sessions.results as { updated_at: number }[])]
  return {
    sections: sections.results as SportData['sections'],
    sessions: sessions.results as SportData['sessions'],
    updated_at: all.length ? Math.max(...all.map((r) => r.updated_at)) : null,
  }
}

export async function handleSportGet(env: Env): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, ...(await loadSport(env)) }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  })
}

type Body = Record<string, unknown>

// секция: {id?, name, emoji, teacher, place, place_id, about, sort}
export async function sportSectionSave(env: Env, body: Body): Promise<Response> {
  const id = asInt(body.id)
  const name = clip(body.name, 60)
  if (name.length < 2) return fail('Напишите название секции')
  const row = [name, clip(body.emoji, 8) || null, clip(body.teacher, 80) || null, clip(body.place, 80) || null,
    clip(body.place_id, 40) || null, clip(body.about, 400) || null, asInt(body.sort) ?? 0, Date.now()] as const
  try {
    if (id === null) {
      await env.DB.prepare(
        'INSERT INTO sport_sections (name, emoji, teacher, place, place_id, about, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(...row).run()
    } else {
      await env.DB.prepare(
        'UPDATE sport_sections SET name = ?, emoji = ?, teacher = ?, place = ?, place_id = ?, about = ?, sort = ?, updated_at = ? WHERE id = ?',
      ).bind(...row, id).run()
    }
  } catch (err) {
    if (String(err).includes('UNIQUE')) return fail('Секция с таким названием уже есть')
    throw err
  }
  return json({ ok: true, ...(await loadSport(env)) })
}

export async function sportSectionDelete(env: Env, body: Body): Promise<Response> {
  const id = asInt(body.id)
  if (id === null) return fail('bad request')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sport_sessions WHERE section_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sport_sections WHERE id = ?').bind(id),
  ])
  return json({ ok: true, ...(await loadSport(env)) })
}

type SessionInput = { weekday: number; start: string; end: string; weeks: string; teacher: string | null; place: string | null }

// одно занятие из запроса или строки импорта; строка — ошибка для человека
function readSession(raw: Body): SessionInput | string {
  const weekday = asInt(raw.weekday)
  if (weekday === null || weekday < 0 || weekday > 6) return 'день недели'
  const start = normTime(raw.start)
  const end = normTime(raw.end)
  if (!TIME.test(start) || !TIME.test(end) || start >= end) return 'время начала и конца'
  const weeks = normalizeWeeks(clip(raw.weeks, 60))
  const problem = weeksProblem(weeks)
  if (problem) return problem
  return { weekday, start, end, weeks, teacher: clip(raw.teacher, 80) || null, place: clip(raw.place, 80) || null }
}

// занятие: {id?, section_id, weekday, start, end, weeks, teacher, place}
export async function sportSessionSave(env: Env, body: Body): Promise<Response> {
  const id = asInt(body.id)
  const section = asInt(body.section_id)
  if (section === null) return fail('bad request')
  const s = readSession(body)
  if (typeof s === 'string') return fail(`Проверьте: ${s}`)
  const now = Date.now()
  if (id === null) {
    await env.DB.prepare(
      `INSERT INTO sport_sessions (section_id, weekday, start, end, weeks, teacher, place, updated_at)
       SELECT id, ?, ?, ?, ?, ?, ?, ? FROM sport_sections WHERE id = ?`,
    ).bind(s.weekday, s.start, s.end, s.weeks, s.teacher, s.place, now, section).run()
  } else {
    await env.DB.prepare(
      'UPDATE sport_sessions SET weekday = ?, start = ?, end = ?, weeks = ?, teacher = ?, place = ?, updated_at = ? WHERE id = ?',
    ).bind(s.weekday, s.start, s.end, s.weeks, s.teacher, s.place, now, id).run()
  }
  return json({ ok: true, ...(await loadSport(env)) })
}

export async function sportSessionDelete(env: Env, body: Body): Promise<Response> {
  const id = asInt(body.id)
  if (id === null) return fail('bad request')
  await env.DB.prepare('DELETE FROM sport_sessions WHERE id = ?').bind(id).run()
  return json({ ok: true, ...(await loadSport(env)) })
}

// Импорт: {rows: [{section, weekday, start, end, weeks, teacher, place}]} — занятия секций из файла
// заменяются целиком (секции, которых в файле нет, не трогаем). Ошибка в строке — не импортируем ничего.
export async function sportImport(env: Env, body: Body): Promise<Response> {
  const rows = Array.isArray(body.rows) ? (body.rows as Body[]) : []
  if (!rows.length) return fail('В файле нет строк с занятиями')
  if (rows.length > 1500) return fail('Слишком много строк — не больше 1500')
  const clean: (SessionInput & { section: string })[] = []
  const errors: string[] = []
  rows.forEach((raw, i) => {
    const section = clip(raw.section, 60)
    const s = readSession(raw)
    if (section.length < 2) errors.push(`строка ${i + 1}: нет названия секции`)
    else if (typeof s === 'string') errors.push(`строка ${i + 1}: ${s}`)
    else clean.push({ ...s, section })
  })
  if (errors.length) return json({ ok: false, error: 'Ошибки в файле', errors: errors.slice(0, 30) }, 400)
  const now = Date.now()
  const payload = JSON.stringify(clean)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO sport_sections (name, updated_at)
       SELECT DISTINCT json_extract(value, '$.section'), ?2 FROM json_each(?1)`,
    ).bind(payload, now),
    env.DB.prepare(
      `DELETE FROM sport_sessions WHERE section_id IN (
         SELECT id FROM sport_sections WHERE name IN (SELECT json_extract(value, '$.section') FROM json_each(?1)))`,
    ).bind(payload),
    env.DB.prepare(
      `INSERT INTO sport_sessions (section_id, weekday, start, end, weeks, teacher, place, updated_at)
       SELECT s.id, json_extract(j.value, '$.weekday'), json_extract(j.value, '$.start'), json_extract(j.value, '$.end'),
              json_extract(j.value, '$.weeks'), json_extract(j.value, '$.teacher'), json_extract(j.value, '$.place'), ?2
       FROM json_each(?1) j JOIN sport_sections s ON s.name = json_extract(j.value, '$.section')`,
    ).bind(payload, now),
  ])
  return json({ ok: true, imported: clean.length, ...(await loadSport(env)) })
}
