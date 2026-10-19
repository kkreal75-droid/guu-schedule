// Запросы мини-приложения к воркеру: тело — JSON {initData, ...}, подпись Telegram проверяем
// здесь, один раз. text/plain без CORS-предзапроса, ответ — JSON с Access-Control-Allow-Origin.
import { isOwner, verifyInitData, type Profile } from './auth'
import { getUser } from './db'

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS })

export type ApiRequest<T> = { profile: Profile; body: T; admin: boolean }

// Проверяет подпись; при неудаче — готовый ответ 403. adminOnly — только OWNER_ID.
export async function readApi<T extends object>(
  env: Env,
  request: Request,
  options: { adminOnly?: boolean; allowBanned?: boolean } = {},
): Promise<ApiRequest<T> | Response> {
  let parsed: { initData?: string } & T
  try {
    parsed = JSON.parse(await request.text())
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }
  const profile = await verifyInitData(parsed.initData ?? '', env)
  if (!profile) return json({ ok: false, error: 'forbidden' }, 403)
  const admin = isOwner(env, profile.id)
  if (options.adminOnly && !admin) return json({ ok: false, error: 'forbidden' }, 403)
  if (!admin && !options.allowBanned) {
    const user = await getUser(env.DB, profile.id)
    if (user?.banned) return json({ ok: false, error: 'banned' }, 403)
  }
  const { initData: _, ...body } = parsed
  return { profile, body: body as T, admin }
}
