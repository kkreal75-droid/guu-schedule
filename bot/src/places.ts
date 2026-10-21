// «Корпуса ГУУ» (этап 7.7): места кампуса — public/data/places.json на сайте; правки владельца из админки
// («Места») — D1 place_edits, приложение накладывает их на файл само.
//   GET /places — правки всем (данные публичные), кэш 60 с;
//   POST /admin/place-* — только OWNER_ID (проверку делает handleAdminApi).
import { json } from './api'
import { cachedJson, forgetCached } from './guard'

const GROUPS = ['buildings', 'sport', 'food', 'other']
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const list = (v: unknown, items: number, max: number) =>
  Array.isArray(v) ? [...new Set(v.map((s) => clip(s, max)).filter(Boolean))].slice(0, items) : []
const coord = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? Math.round(v * 1e6) / 1e6 : null)
const fail = (error: string) => json({ ok: false, error }, 400)

export type PlaceEditRow = { id: string; data: Record<string, unknown>; updated_at: number }

export async function loadPlaceEdits(env: Env): Promise<PlaceEditRow[]> {
  const { results } = await env.DB.prepare('SELECT id, data, updated_at FROM place_edits ORDER BY updated_at').all<{
    id: string
    data: string
    updated_at: number
  }>()
  return results.map((r) => ({ id: r.id, data: JSON.parse(r.data) as Record<string, unknown>, updated_at: r.updated_at }))
}

// публичное: из памяти изолята (D1 — раз в минуту) с ETag
export const handlePlacesGet = (env: Env, request: Request) =>
  cachedJson(request, 'places', 60_000, async () => ({ ok: true, edits: await loadPlaceEdits(env) }))

// «Как пройти»: строка — пункт; не больше 12 пунктов по 300 символов
const howto = (v: unknown) =>
  typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').split('\n').map((line) => clip(line, 300)).filter(Boolean).slice(0, 12).join('\n')
    : ''

// {id?, place: {...}} — id нет: новое место; id из файла — правка поверх него
export async function placeSave(env: Env, body: Record<string, unknown>): Promise<Response> {
  const raw = (body.place ?? {}) as Record<string, unknown>
  const id = body.id === undefined || body.id === null ? `x-${Date.now().toString(36)}` : clip(body.id, 40)
  if (!ID.test(id)) return fail('bad request')
  const hidden = raw.hidden === true
  const name = clip(raw.name, 80)
  const lat = coord(raw.lat, 90)
  const lon = coord(raw.lon, 180)
  if (!hidden) {
    if (name.length < 2) return fail('Напишите название места')
    if (lat === null || lon === null) return fail('Проверьте координаты: широта и долгота числами, например 55.7140, 37.8115')
  }
  const group = GROUPS.includes(String(raw.group)) ? String(raw.group) : 'other'
  const data = {
    name, short: clip(raw.short, 12) || null, icon: clip(raw.icon, 8) || '📍', group, address: clip(raw.address, 160),
    lat, lon, howto: howto(raw.howto), note: clip(raw.note, 300) || null, todo: clip(raw.todo, 300) || null,
    rooms: list(raw.rooms, 12, 30), aliases: list(raw.aliases, 20, 40), ...(hidden ? { hidden: true } : {}),
    // английская версия (этап 11): название, адрес, «Как пройти», заметка — пусто: как в файле
    name_en: clip(raw.name_en, 80) || null, address_en: clip(raw.address_en, 160) || null,
    howto_en: howto(raw.howto_en) || null, note_en: clip(raw.note_en, 300) || null,
  }
  await env.DB.prepare(
    `INSERT INTO place_edits (id, data, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET data = ?2, updated_at = ?3`,
  ).bind(id, JSON.stringify(data), Date.now()).run()
  forgetCached('places')
  return json({ ok: true, id, edits: await loadPlaceEdits(env) })
}

// вернуть как в файле (новое место — удалить)
export async function placeReset(env: Env, body: Record<string, unknown>): Promise<Response> {
  const id = clip(body.id, 40)
  if (!ID.test(id)) return fail('bad request')
  await env.DB.prepare('DELETE FROM place_edits WHERE id = ?').bind(id).run()
  forgetCached('places')
  return json({ ok: true, edits: await loadPlaceEdits(env) })
}
