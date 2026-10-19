// Настройки, которые админ меняет в панели без передеплоя: приветствия, техработы, объявление.
// Лежат в KV (ключ settings) — пишутся редко; читаем с кэшем в памяти на минуту.

export type Settings = {
  greetings: string[] // HTML, {имя} — имя пользователя
  maintenance: { on: boolean; text: string }
  notice: { on: boolean; id: number; text: string } // плашка над расписанием; новый текст — новый id
}

export const DEFAULT_GREETINGS = [
  `<b>{имя}, здарова, брат!</b> 🤝

Как ты, мой дорогой? Надеюсь, выспался 😴

Держи <b>бесплатное расписание</b> МБ(МП) 1-1 и 1-2 — без подписок, без регистрации, без смс 🎁

📅 какая пара, где и у кого
🔁 чётная или нечётная неделя — уже посчитано
📝 заметки, чтобы не забыть домашку

Пользуйся на здоровье, брат 👇`,
  `<b>{имя}, брат, здарова!</b> 👊
Как жизнь, родной? Всё ровно?
Вот тебе расписание — бесплатно, от души ❤️ 👇`,
  `<b>Ооо, {имя}! Здарова, брат!</b> 🫂
Как сам, дорогой? Давно не виделись.
Держи расписание — бесплатно, как для своих 👇`,
]

const DEFAULTS: Settings = {
  greetings: DEFAULT_GREETINGS,
  maintenance: { on: false, text: 'Скоро вернёмся — обновляем расписание.' },
  notice: { on: false, id: 0, text: '' },
}

const KEY = 'settings'
const MEMORY_TTL_MS = 60_000
let cached: { at: number; settings: Settings } | null = null

// fresh — мимо кэша (админ-панель должна видеть ровно то, что сохранено)
export async function loadSettings(env: Env, fresh = false): Promise<Settings> {
  if (!fresh && cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.settings
  const stored = (await env.KV.get<Partial<Settings>>(KEY, 'json')) ?? {}
  const settings: Settings = {
    greetings: stored.greetings?.length === 3 ? stored.greetings : DEFAULTS.greetings,
    maintenance: { ...DEFAULTS.maintenance, ...stored.maintenance },
    notice: { ...DEFAULTS.notice, ...stored.notice },
  }
  cached = { at: Date.now(), settings }
  return settings
}

export async function saveSettings(env: Env, settings: Settings): Promise<void> {
  await env.KV.put(KEY, JSON.stringify(settings))
  cached = { at: Date.now(), settings }
}

// {имя} → имя (уже экранированное) жирным не делаем — жирность задаёт сам текст
export const renderGreeting = (template: string, name: string) => template.replaceAll('{имя}', name)

// Telegram отклонит сообщение с неизвестным или незакрытым тегом — проверяем заранее
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'tg-spoiler', 'blockquote'])

export function htmlProblem(html: string): string | null {
  const stack: string[] = []
  for (const match of html.matchAll(/<(\/?)([a-z-]+)(\s[^>]*)?>|</gi)) {
    if (match[0] === '<') return 'одиночный символ < напишите как &amp;lt;'
    const [, closing, rawName] = match
    const name = rawName.toLowerCase()
    if (!ALLOWED_TAGS.has(name)) return `тег <${name}> Telegram не поддерживает`
    if (!closing) stack.push(name)
    else if (stack.pop() !== name) return `тег </${name}> закрыт не там`
  }
  return stack.length ? `тег <${stack.at(-1)}> не закрыт` : null
}
