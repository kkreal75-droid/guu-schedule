// Ошибки: пользователю — «Что-то сломалось 🛠», владельцу в личку — текст ошибки.
import { tr, type Lang } from './i18n'
import { sendMessage } from './telegram'
import { escapeHtml } from './util'

export const ERROR_REPLY = 'Что-то сломалось 🛠'

export async function reportError(env: Env, where: string, err: unknown): Promise<void> {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`${where}:`, text)
  if (!env.OWNER_ID) return
  try {
    await sendMessage(env, Number(env.OWNER_ID), `🛠 <b>Ошибка</b> · ${escapeHtml(where)}\n<pre>${escapeHtml(text.slice(0, 3500))}</pre>`)
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
