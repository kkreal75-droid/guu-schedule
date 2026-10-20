// Служебные записи в D1: обработанные обновления Telegram (повторы пропускаем) и журнал действий владельца.
// Журнал в интерфейсе не показывается — он для разбора инцидентов (кто, что, когда).

const KEEP_UPDATES_MS = 2 * 86_400_000
const KEEP_LOG_MS = 365 * 86_400_000

// последние update_id этого изолята — повтор от Telegram чаще всего приходит сюда же, без похода в D1
const recent = new Set<number>()

// true — обновление пришло впервые. Telegram повторяет его, если не дождался ответа или получил 5xx.
export async function firstDelivery(env: Env, updateId: number): Promise<boolean> {
  if (!Number.isSafeInteger(updateId)) return true
  if (recent.has(updateId)) return false
  recent.add(updateId)
  if (recent.size > 2000) recent.delete(recent.values().next().value!)
  const { meta } = await env.DB.prepare('INSERT OR IGNORE INTO tg_updates (update_id, at) VALUES (?, ?)')
    .bind(updateId, Date.now())
    .run()
  return meta.changes > 0
}

// Действие владельца: что сделал и над кем. Ошибка записи не мешает самому действию.
export async function logAdmin(env: Env, actor: number, action: string, target?: string | number | null, details?: unknown) {
  try {
    const text = details === undefined ? null : (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 500)
    await env.DB.prepare('INSERT INTO admin_log (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), actor, action.slice(0, 60), target === undefined || target === null ? null : String(target).slice(0, 120), text)
      .run()
  } catch (err) {
    console.error('Журнал действий:', err)
  }
}

// Раз в час (cron): старые update_id и журнал старше года
export async function cleanupJournal(env: Env, now: number): Promise<number> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tg_updates WHERE at < ?').bind(now - KEEP_UPDATES_MS),
    env.DB.prepare('DELETE FROM admin_log WHERE at < ?').bind(now - KEEP_LOG_MS),
  ])
  return 1
}
