// GitHub API от имени воркера (секрет GITHUB_TOKEN: fine-grained, только этот репозиторий, Actions: read & write) —
// «Обновить сейчас» в админке и автозапуск обновления (updates.ts). Каждый ответ сверяем с токеном:
//   • срок — из заголовка github-authentication-token-expiration (KV `github-token-expiry`, пишется при смене);
//     за 14 дней до конца — предупреждение владельцу (не чаще раза в сутки);
//   • 401 / 403 — сразу владельцу (не чаще раза в час): токен истёк, отозван или без прав.
// Сам токен никуда не выводится: ни в сообщения, ни в логи, ни в ответы.
import { sendMessage } from './telegram'

const EXPIRY_KEY = 'github-token-expiry'
const EXPIRY_ALERT = 'github-token-expiry-alert'
const AUTH_ALERT = 'github-token-auth-alert'
const WARN_MS = 14 * 86_400_000

export function github(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const base = env.GITHUB_API || 'https://api.github.com'
  return fetch(`${base}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      'User-Agent': 'guu-schedule-bot',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }).then(async (res) => {
    if (env.GITHUB_TOKEN) await noteToken(env, res).catch((err) => console.error('Проверка срока GITHUB_TOKEN:', err))
    return res
  })
}

// «2027-01-23 12:00:00 UTC» (так пишет GitHub) → мс; не разобрали — null
export function parseExpiry(raw: string | null): number | null {
  if (!raw) return null
  const iso = raw.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)\s*(UTC)?\s*([+-]\d{2}:?\d{2})?$/, (_, d, t, _utc, off) => `${d}T${t}${off ? off.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z'}`)
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

const day = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
const owner = (env: Env, text: string) => sendMessage(env, Number(env.OWNER_ID), text)
const HOW = 'Выпусти новый fine-grained токен (только репозиторий guu-schedule, Actions: Read and write) и задай его в bot/: npx wrangler secret put GITHUB_TOKEN.'

export async function noteToken(env: Env, res: Response, now = Date.now()): Promise<void> {
  if (res.status === 401 || res.status === 403) {
    if (await env.KV.get(AUTH_ALERT)) return
    await env.KV.put(AUTH_ALERT, '1', { expirationTtl: 3600 })
    const why = res.status === 401 ? 'токен недействителен — истёк или отозван' : 'у токена нет прав на Actions этого репозитория'
    await owner(env, `🔑 <b>GITHUB_TOKEN</b>: GitHub ответил ${res.status} — ${why}. Автозапуск обновления и «Обновить сейчас» не работают.\n${HOW}`)
    return
  }
  const raw = res.headers.get('github-authentication-token-expiration')
  const expires = parseExpiry(raw)
  if (!expires) return
  if ((await env.KV.get(EXPIRY_KEY)) !== String(expires)) await env.KV.put(EXPIRY_KEY, String(expires))
  const left = expires - now
  if (left > WARN_MS || (await env.KV.get(EXPIRY_ALERT))) return
  await env.KV.put(EXPIRY_ALERT, '1', { expirationTtl: 86_400 })
  const days = Math.max(0, Math.ceil(left / 86_400_000))
  await owner(env, `🔑 <b>GITHUB_TOKEN</b> истекает ${day(expires)} — ${days > 0 ? `через ${days} дн.` : 'сегодня'}. После этого бот не сможет сам запускать обновление расписания.\n${HOW}`)
}

// Раз в сутки — проверка токена, даже если обновление не запускали (дешёвый запрос: сам репозиторий)
export async function dailyTokenCheck(env: Env): Promise<number> {
  if (!env.GITHUB_TOKEN || (await env.KV.get('github-token-checked'))) return 1
  await env.KV.put('github-token-checked', '1', { expirationTtl: 86_400 })
  await github(env, '')
  return 3
}
