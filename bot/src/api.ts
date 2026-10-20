// Запросы мини-приложения к воркеру: тело — JSON {initData, ...}, подпись Telegram проверяем
// здесь, один раз. text/plain без CORS-предзапроса; CORS — только для origin приложения (guard.ts).
// Порядок дешёвый → дорогой: размер тела, подпись (CPU), лимит запросов, и только потом D1.
import { isOwner, verifyInitData, type Profile } from './auth'
import { getUser, type UserRow } from './db'
import { BODY_LIMIT, allow, readBody, tooMany } from './guard'

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS })

export type ApiRequest<T> = { profile: Profile; body: T; admin: boolean; user: UserRow | null }

type Options = {
  adminOnly?: boolean // только OWNER_ID
  allowBanned?: boolean
  write?: boolean // запись — свой, более строгий лимит
  maxBody?: number
}

// Проверяет подпись; при неудаче — готовый ответ 403 (413 — тело велико, 429 — слишком часто).
export async function readApi<T extends object>(
  env: Env,
  request: Request,
  options: Options = {},
): Promise<ApiRequest<T> | Response> {
  const text = await readBody(request, options.maxBody ?? BODY_LIMIT)
  if (text instanceof Response) return text
  let parsed: { initData?: unknown } & T
  try {
    parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }
  const profile = await verifyInitData(typeof parsed.initData === 'string' ? parsed.initData : '', env)
  if (!profile) return json({ ok: false, error: 'forbidden' }, 403)
  const admin = isOwner(env, profile.id)
  if (options.adminOnly && !admin) return json({ ok: false, error: 'forbidden' }, 403)
  if (!(await allow(env, 'RL_USER', profile.id))) return tooMany()
  if (options.write && !admin && !(await allow(env, 'RL_WRITE', profile.id))) return tooMany()
  const user = await getUser(env.DB, profile.id)
  if (!admin && !options.allowBanned && user?.banned) return json({ ok: false, error: 'banned' }, 403)
  const { initData: _, ...body } = parsed
  return { profile, body: body as T, admin, user }
}
