// Ошибки: пользователю — «Что-то сломалось 🛠», владельцу в личку — текст ошибки.
// Одна и та же ошибка (место + первая строка, числа не в счёт) — владельцу не чаще раза в час: в памяти изолята
// и в KV (запись только при новой ошибке), иначе при сбое она приходила на каждое сообщение.
import { tr, type Lang } from './i18n'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

export const ERROR_REPLY = 'Что-то сломалось 🛠'

const REPEAT_S = 3600
const recent = new Map<string, number>()

async function errorKey(where: string, text: string): Promise<string> {
  const first = text.split('\n')[0].replace(/\d+/g, '#').slice(0, 300)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${where}|${first}`))
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// уже сообщали за последний час? (и запоминаем, что сообщаем сейчас)
async function reportedRecently(env: Env, key: string): Promise<boolean> {
  const now = Date.now()
  const at = recent.get(key)
  if (at && now - at < REPEAT_S * 1000) return true
  recent.set(key, now)
  if (recent.size > 200) recent.delete(recent.keys().next().value!)
  try {
    if (await env.KV.get(`err:${key}`)) return true
    await env.KV.put(`err:${key}`, '1', { expirationTtl: REPEAT_S })
  } catch {
    // KV недоступен — лучше сообщить лишний раз, чем промолчать
  }
  return false
}

export async function reportError(env: Env, where: string, err: unknown): Promise<void> {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`${where}:`, text)
  if (!env.OWNER_ID) return
  try {
    if (await reportedRecently(env, await errorKey(where, text))) return
    await sendMessage(
      env,
      Number(env.OWNER_ID),
      `🛠 <b>Ошибка</b> · ${escapeHtml(where)}\n<pre>${escapeHtml(text.slice(0, 3500))}</pre>\n<i>Такая же ошибка в ближайший час больше не придёт.</i>`,
    )
  } catch (sendErr) {
    console.error('Не удалось сообщить владельцу об ошибке:', sendErr)
  }
}

// Выполняет обработчик; при ошибке отвечает в чат (если он известен) на языке человека и пишет владельцу
export async function safely(env: Env, where: string, chatId: number | null, run: () => Promise<void>, lang: Lang = 'ru'): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (chatId !== null) {
      await sendMessage(env, chatId, tr(lang, ERROR_REPLY)).catch((sendErr) => console.error('Не удалось ответить об ошибке:', sendErr))
    }
    await reportError(env, where, err)
  }
}
