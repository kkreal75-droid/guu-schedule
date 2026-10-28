// npm run deploy: проверка конфигурации → wrangler deploy → проверка прода → откат, если бот не в порядке.
//   1) WEBHOOK_URL в wrangler.jsonc — https://…/webhook (иначе деплой не начинается);
//   2) запоминаем текущую версию воркера;
//   3) wrangler deploy;
//   4) до 2 минут ждём: GET /health → ok, D1 и вебхук в Telegram в порядке (воркер сам сверяет getWebhookInfo);
//      POST /webhook без ключа → 403 (обработчик жив); GET / → 404 (настройка не публичная);
//   5) не дождались — wrangler rollback на прошлую версию. Владельцу пишет сам воркер: cron откатившейся версии
//      видит, что она старше проверенной, сверяет вебхук и присылает «Воркер откатился…» (src/setup.ts → afterDeploy).
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const hook = config.match(/"WEBHOOK_URL"\s*:\s*"([^"]+)"/)?.[1] ?? ''
let base
try {
  const url = new URL(hook)
  if (url.protocol !== 'https:' || url.pathname !== '/webhook' || url.search) throw new Error()
  base = url.origin
} catch {
  console.error(`✖ WEBHOOK_URL в wrangler.jsonc должен быть https://…/webhook (сейчас: «${hook}») — деплой отменён`)
  process.exit(1)
}

const wrangler = (args, opts = {}) => spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit', ...opts })
let previous = null
try {
  const list = JSON.parse(execFileSync('npx', ['wrangler', 'deployments', 'list', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
  previous = list.at(-1)?.versions?.[0]?.version_id ?? null
} catch {
  console.warn('⚠ Не узнал текущую версию воркера — откатить автоматически не получится')
}

if (wrangler(['deploy']).status !== 0) process.exit(1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function checks() {
  const problems = []
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.ok !== true || body.webhook !== true) problems.push(`/health: ${res.status} ${JSON.stringify(body)}`)
  } catch (err) {
    problems.push(`/health: ${err}`)
  }
  const webhook = await fetch(`${base}/webhook`, { method: 'POST', body: '{}' }).catch((err) => ({ status: String(err) }))
  if (webhook.status !== 403) problems.push(`POST /webhook без ключа: ${webhook.status} (ждали 403)`)
  const root = await fetch(`${base}/`).catch((err) => ({ status: String(err) }))
  if (root.status !== 404) problems.push(`GET /: ${root.status} (ждали 404)`)
  return problems
}

let problems = []
for (let i = 0; i < 12; i++) {
  await sleep(i ? 10_000 : 5_000) // /health кэширует проверку 30 с — даём время
  problems = await checks()
  if (!problems.length) break
}
if (!problems.length) {
  console.log('✓ Проверка после деплоя: /health, вебхук, обработчик — в порядке')
  process.exit(0)
}
console.error(`✖ Проверка после деплоя не прошла:\n  ${problems.join('\n  ')}`)
if (!previous) process.exit(1)
console.error(`↩ Откатываю на ${previous}…`)
wrangler(['rollback', previous, '--message', 'автооткат: проверка после деплоя не прошла', '--yes'])
process.exit(1)
