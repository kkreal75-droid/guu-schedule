// Ежедневный бэкап D1: все таблицы одним batch → JSON → gzip → документом владельцу в личку бота.
// Личка владельца — приватное место без настроек (Telegram хранит файлы в облаке); если понадобится место
// побольше — R2 (включить в панели Cloudflare). Восстановление — scripts/d1_restore.py, docs/backup.md.
import { tgForm } from './telegram'

// служебное, которое восстанавливать не нужно
const SKIP = new Set(['d1_migrations', 'tg_updates'])
const MAX_BYTES = 45 * 1024 * 1024 // Telegram принимает документы до 50 МБ

export async function backupToOwner(env: Env, now = Date.now()): Promise<number> {
  if (!env.OWNER_ID) return 0
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string }>()
  // имена — из sqlite_master, не от пользователя; в кавычках на случай необычных имён
  const tables = results.map((r) => r.name).filter((name) => !SKIP.has(name) && /^[a-z0-9_]+$/i.test(name))
  const data = await env.DB.batch(tables.map((name) => env.DB.prepare(`SELECT * FROM "${name}"`)))
  const dump = {
    format: 'guu-bot-d1-backup',
    version: 1,
    at: new Date(now).toISOString(),
    tables: Object.fromEntries(tables.map((name, i) => [name, data[i].results])),
  }
  const rows = data.reduce((sum, r) => sum + r.results.length, 0)
  const gz = await new Response(
    new Blob([JSON.stringify(dump)]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  const day = new Date(now + 3 * 3_600_000).toISOString().slice(0, 10)
  const form = new FormData()
  form.append('chat_id', env.OWNER_ID)
  form.append('disable_notification', 'true')
  if (gz.byteLength > MAX_BYTES) {
    form.append('text', `⚠️ Бэкап базы ${day} не отправлен: ${Math.round(gz.byteLength / 1048576)} МБ — больше лимита Telegram. Нужен R2 (см. docs/backup.md).`)
    await tgForm(env, 'sendMessage', form)
    return 3
  }
  form.append('document', new Blob([gz], { type: 'application/gzip' }), `guu-bot-${day}.json.gz`)
  form.append('caption', `🗄 Бэкап базы · ${day} · таблиц: ${tables.length}, строк: ${rows} · ${Math.ceil(gz.byteLength / 1024)} КБ\nВосстановление — docs/backup.md в репозитории.`)
  await tgForm(env, 'sendDocument', form)
  return 3
}
