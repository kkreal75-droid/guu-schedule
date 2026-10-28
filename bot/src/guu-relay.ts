// Запасной путь к guu.ru для автообновления (update.py → GUU_RELAY): с раннеров GitHub guu.ru временами не отвечает,
// а из сети Cloudflare отвечает. GET /guu?url=… — только https://guu.ru, только страницы расписания, сессии и
// «Сведений» и файлы из /wp-content/uploads/ (xlsx, doc, docx, pdf). Перенаправления — только внутри guu.ru.
// Лимит — RL_PUBLIC по IP (index.ts). Ответ не кэшируем: update.py сам сравнивает SHA-256.
const PATHS = [/^\/student\/(schedule|session)\/$/, /^\/sveden\/education\/$/, /^\/wp-content\/uploads\/[^?#]+\.(xlsx|xls|docx?|pdf)$/i]
export const GUU_USER_AGENT = 'guu-schedule-updater/2.0 (+https://github.com)' // без слова «bot»: иначе guu.ru даёт 403

export function guuTarget(raw: string | null): URL | null {
  if (!raw || raw.length > 2000) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'guu.ru' || url.port || url.username || url.password || url.search || url.hash) return null
  return PATHS.some((re) => re.test(decodeURIComponent(url.pathname))) ? url : null
}

export async function handleGuuRelay(url: URL): Promise<Response> {
  const target = guuTarget(url.searchParams.get('url'))
  if (!target) return new Response('not found', { status: 404 })
  let res: Response
  try {
    res = await fetch(target.toString(), {
      headers: { 'User-Agent': GUU_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    return new Response('guu.ru не ответил', { status: 504 })
  }
  // перенаправили за пределы guu.ru — не отдаём
  if (new URL(res.url || target.toString()).hostname !== 'guu.ru') return new Response('bad redirect', { status: 502 })
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
  })
}
