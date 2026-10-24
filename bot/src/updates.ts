// Присмотр за автообновлением расписания и рассылка об изменениях (cron раз в 10 минут, минута %10 = 9).
// update.py кладёт на сайт data/status.json (последняя УСПЕШНАЯ проверка guu.ru и какие там файлы) и
// data/changes.json (у каких групп поменялись пары в последней публикации). Здесь:
//   • 3 часа без успешной проверки — тревога владельцу (повтор — раз в 3 часа);
//   • воркер сам смотрит страницы guu.ru (из сети Cloudflare они открываются): новый файл не опубликован
//     за 2 часа — тревога (повтор — раз в 2 часа); есть GITHUB_TOKEN — сразу запускаем workflow обновления;
//   • новая публикация — рассылка «🔄 Расписание обновилось» людям тех групп, где поменялись пары
//     (группе — не чаще раза в 6 часов, публикации старше суток не рассылаем).
// Тревоги — sendMessage напрямую в Telegram: доходят, даже если вебхук бота сломан.
import { normalizeGroup } from '../../shared/groups'
import { github } from './admin-api'
import { systemBroadcast } from './broadcast'
import { GUU_USER_AGENT } from './guu-relay'
import { reportError } from './errors'
import { tr } from './i18n'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

type Status = { checked_at: string; via?: string; files?: string[] }
type Changes = { id: string; at: string; groups: string[]; files?: string[] }

const HOUR = 3_600_000
const STALE_MS = 3 * HOUR
const UNPUBLISHED_MS = 2 * HOUR
const PAGES = ['https://guu.ru/student/schedule/', 'https://guu.ru/student/session/']
const FILE = /href="([^"]+\.(?:xlsx|docx?))"/gi

const msk = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hours = (ms: number) => Math.floor(ms / HOUR)

async function siteJson<T>(env: Env, path: string): Promise<T | null> {
  const res = await fetch(new URL(path, env.WEBAPP_URL).toString(), {
    cf: { cacheTtlByStatus: { '200-299': 60, '404': 30, '500-599': 0 }, cacheEverything: true },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

// Имена файлов на страницах guu.ru — как их видит update.py (последняя часть адреса, раскодированная)
export function guuFileNames(html: string, page: string): string[] {
  const names = new Set<string>()
  for (const m of html.matchAll(FILE)) {
    try {
      const url = new URL(m[1].replace(/&amp;/g, '&'), page)
      if (url.hostname === 'guu.ru' || url.hostname.endsWith('.guu.ru')) names.add(decodeURIComponent(url.pathname.split('/').pop()!))
    } catch {
      // битая ссылка — пропускаем
    }
  }
  return [...names]
}

async function guuFiles(): Promise<string[] | null> {
  const all: string[] = []
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { headers: { 'User-Agent': GUU_USER_AGENT }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) return null
      all.push(...guuFileNames(await res.text(), page))
    } catch {
      return null // guu.ru не ответил и нам — сравнивать не с чем
    }
  }
  return all
}

// Запуск workflow обновления (как «Обновить сейчас» в админке) — не чаще раза в 30 минут
async function dispatchUpdate(env: Env): Promise<boolean> {
  if (!env.GITHUB_TOKEN || (await env.KV.get('update-dispatch'))) return false
  await env.KV.put('update-dispatch', '1', { expirationTtl: 30 * 60 })
  const res = await github(env, `/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { force: 'false' } }),
  })
  if (res.status !== 204) throw new Error(`GitHub: запуск обновления — HTTP ${res.status}`)
  return true
}

const owner = (env: Env, text: string) => sendMessage(env, Number(env.OWNER_ID), text)

export async function watchUpdates(env: Env, now = Date.now()): Promise<number> {
  let used = 1
  const status = await siteJson<Status>(env, 'data/status.json')
  const checked = status?.checked_at ? Date.parse(status.checked_at) : NaN
  const stale = Number.isFinite(checked) && now - checked > STALE_MS
  if (stale && !(await env.KV.get('update-stale-alert'))) {
    await env.KV.put('update-stale-alert', '1', { expirationTtl: 3 * 3600 })
    await owner(
      env,
      `⏳ <b>Автообновление расписания</b>\nУже ${hours(now - checked)} ч нет успешной проверки guu.ru (последняя — ${msk(checked)}). ` +
        (env.GITHUB_TOKEN
          ? 'Запускаю обновление сам; если не поможет — посмотри GitHub Actions.'
          : 'GitHub запускает обновление нерегулярно. Чтобы бот запускал его сам, нужен секрет GITHUB_TOKEN (см. docs/roadmap.md, сбой 24.10).'),
    )
    used += 2
  }

  // новые файлы на guu.ru, которых нет в последней успешной проверке
  const files = status ? await guuFiles() : null
  used += 2
  let unpublished: string[] = []
  if (files && status?.files) {
    const known = new Set(status.files)
    unpublished = [...new Set(files.filter((f) => !known.has(f)))].sort()
    const saved = (await env.KV.get<Record<string, number>>('guu-unpublished', 'json')) ?? {}
    const next = Object.fromEntries(unpublished.map((f) => [f, saved[f] ?? now]))
    if (JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(saved).sort())) {
      await env.KV.put('guu-unpublished', JSON.stringify(next))
    }
    const old = unpublished.filter((f) => now - next[f] > UNPUBLISHED_MS)
    if (old.length && !(await env.KV.get('guu-unpublished-alert'))) {
      await env.KV.put('guu-unpublished-alert', '1', { expirationTtl: 2 * 3600 })
      await owner(
        env,
        `🆕 <b>Автообновление расписания</b>\nНа guu.ru новые файлы, а мы их не опубликовали уже ${hours(now - Math.min(...old.map((f) => next[f])))} ч:\n` +
          old.map((f) => `• ${escapeHtml(f)}`).join('\n'),
      )
      used += 2
    }
  }
  // есть токен GitHub — не ждём расписания GitHub: новый файл или проверка старше часа — запускаем обновление
  if (unpublished.length || (Number.isFinite(checked) && now - checked > HOUR + 10 * 60_000)) {
    await dispatchUpdate(env).catch((err) => reportError(env, 'Запуск автообновления', err))
    used += 1
  }
  return used
}

// ---------- «🔄 Расписание обновилось» ----------

const CHANGES_KEY = 'changes-notified'
const TEXT = '🔄 <b>Расписание обновилось</b>\nВ файле ГУУ поменялись пары твоей группы — загляни в расписание.'
const BUTTON = '📅 Открыть расписание'
const REPEAT_MS = 6 * HOUR
const MAX_AGE_MS = 24 * HOUR

export async function notifyChanges(env: Env, now = Date.now()): Promise<number> {
  const changes = await siteJson<Changes>(env, 'data/changes.json')
  if (!changes?.id || !Array.isArray(changes.groups)) return 1
  const saved = await env.KV.get<{ id: string; groups: Record<string, number> }>(CHANGES_KEY, 'json')
  if (saved?.id === changes.id) return 2
  const recent = Object.fromEntries(Object.entries(saved?.groups ?? {}).filter(([, at]) => now - at < REPEAT_MS))
  const at = Date.parse(changes.at)
  const fresh = Number.isFinite(at) && now - at < MAX_AGE_MS ? changes.groups.filter((g) => normalizeGroup(g) === g && !recent[g]) : []
  // сначала помним, кому уже сказали: упадёт рассылка — владелец получит ошибку, дублей не будет
  await env.KV.put(CHANGES_KEY, JSON.stringify({ id: changes.id, groups: { ...recent, ...Object.fromEntries(fresh.map((g) => [g, now])) } }))
  if (!fresh.length) return 4
  const { id, total } = await systemBroadcast(env, {
    text: TEXT,
    text_en: tr('en', TEXT),
    button: { text: BUTTON, text_en: tr('en', BUTTON), url: env.WEBAPP_URL },
    audience: { groups: fresh },
  })
  await owner(env, `🔄 Расписание ГУУ обновилось у групп: <b>${fresh.length}</b>. Рассылка #${id}, получателей: <b>${total}</b>.`)
  return 8
}
