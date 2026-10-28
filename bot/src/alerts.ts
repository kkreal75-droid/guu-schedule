// Тревоги автообновления: update.py (GitHub Actions) кладёт их на сайт в data/alerts.json —
// например, «в файле ГУУ стало на 10% меньше групп, файл не опубликован». Cron раз в 10 минут
// читает файл и присылает владельцу новые тревоги (какие уже прислал — в KV, пишется только при новых).
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

type Alert = { id: string; at: string; text: string }

const SENT_KEY = 'alerts-sent'

export async function sendAlerts(env: Env): Promise<number> {
  const url = new URL('data/alerts.json', env.WEBAPP_URL)
  const res = await fetch(url.toString(), { cf: { cacheTtl: 60, cacheEverything: true } })
  if (res.status === 404) return 1 // сайт ещё без данных
  if (!res.ok) throw new Error(`alerts.json: HTTP ${res.status}`)
  const { alerts = [] } = (await res.json()) as { alerts?: Alert[] }
  if (!alerts.length) return 1
  const sent = new Set((await env.KV.get<string[]>(SENT_KEY, 'json')) ?? [])
  const fresh = alerts.filter((a) => !sent.has(a.id))
  if (!fresh.length) return 2
  for (const alert of fresh.slice(0, 5)) {
    await sendMessage(env, Number(env.OWNER_ID), `🚨 <b>Автообновление расписания</b>\n${escapeHtml(alert.text)}`)
    sent.add(alert.id)
  }
  // помним только актуальные тревоги — список не растёт
  const live = new Set(alerts.map((a) => a.id))
  await env.KV.put(SENT_KEY, JSON.stringify([...sent].filter((id) => live.has(id))))
  return 3 + Math.min(fresh.length, 5)
}
