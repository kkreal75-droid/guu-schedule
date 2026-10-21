// Английская версия (этап 11): переводы названий ГУУ. Словари — на сайте (data/i18n/subjects.en.json — предметы,
// data/i18n/guu.en.json — институты, направления, программы), правки владельца — D1 translations
// (админ-панель → «Переводы»), они важнее словаря.
//   GET /translations — правки всем (данные публичные), кэш 60 с; приложение накладывает их само;
//   POST /admin/translation-save — только OWNER_ID (проверку делает handleAdminApi).
// Боту переводы нужны для английских сообщений, inline и календаря — loadTranslations (кэш 10 минут).
import { json } from './api'
import { cachedJson, forgetCached } from './guard'

export const KINDS = ['subject', 'institute', 'direction', 'program'] as const
export type TranslationKind = (typeof KINDS)[number]
export type TranslationEdit = { kind: TranslationKind; ru: string; en: string; updated_at: number }
export type Translations = Record<TranslationKind, Record<string, string>>

export async function loadTranslationEdits(env: Env): Promise<TranslationEdit[]> {
  const { results } = await env.DB.prepare('SELECT kind, ru, en, updated_at FROM translations ORDER BY kind, ru').all<TranslationEdit>()
  return results
}

export const handleTranslationsGet = (env: Env, request: Request) =>
  cachedJson(request, 'translations', 60_000, async () => ({ ok: true, edits: await loadTranslationEdits(env) }))

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

// {kind, ru, en} — en пустой: убрать правку (останется перевод из словаря)
export async function translationSave(env: Env, body: Record<string, unknown>): Promise<Response> {
  const kind = KINDS.find((k) => k === body.kind)
  const ru = clip(body.ru, 300)
  const en = clip(body.en, 300)
  if (!kind || !ru) return json({ ok: false, error: 'bad request' }, 400)
  if (en && /[А-Яа-яЁё]/.test(en)) return json({ ok: false, error: 'В переводе — русские буквы' }, 400)
  if (en) {
    await env.DB.prepare(
      `INSERT INTO translations (kind, ru, en, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (kind, ru) DO UPDATE SET en = ?3, updated_at = ?4`,
    ).bind(kind, ru, en, Date.now()).run()
  } else {
    await env.DB.prepare('DELETE FROM translations WHERE kind = ? AND ru = ?').bind(kind, ru).run()
  }
  forgetCached('translations')
  cache = null
  return json({ ok: true, edits: await loadTranslationEdits(env) })
}

// ---------- для бота ----------

const TTL_MS = 10 * 60_000
let cache: { at: number; value: Translations } | null = null

async function siteJson<T>(env: Env, path: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(path, env.WEBAPP_URL).toString(), { cf: { cacheTtl: 300, cacheEverything: true } })
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// Словари с сайта + правки владельца; не загрузилось — пусто (бот напишет по-русски, как в файлах ГУУ)
export async function loadTranslations(env: Env): Promise<Translations> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const [subjects, names, edits] = await Promise.all([
    siteJson<Record<string, string>>(env, 'data/i18n/subjects.en.json'),
    siteJson<{ institutes?: Record<string, string>; directions?: Record<string, string>; programs?: Record<string, string> }>(env, 'data/i18n/guu.en.json'),
    loadTranslationEdits(env).catch(() => []),
  ])
  const value: Translations = {
    subject: { ...(subjects ?? {}) },
    institute: { ...(names?.institutes ?? {}) },
    direction: { ...(names?.directions ?? {}) },
    program: { ...(names?.programs ?? {}) },
  }
  for (const e of edits) value[e.kind][e.ru] = e.en
  cache = { at: Date.now(), value }
  return value
}
