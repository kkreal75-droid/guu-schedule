// Настройки, которые админ меняет в панели без передеплоя: приветствия, техработы, объявление, канал новостей.
// Лежат в KV (ключ settings) — пишутся редко; читаем с кэшем в памяти на минуту.

export type Settings = {
  greetings: string[] // HTML, {имя} — имя пользователя
  // text_en — для английского интерфейса (этап 11); пусто — английским тоже русский текст
  maintenance: { on: boolean; text: string; text_en?: string }
  notice: { on: boolean; id: number; text: string; text_en?: string } // плашка над расписанием; новый текст — новый id
  channel: string // «Другое → Канал новостей»: ссылка https://t.me/…; пусто — пункта нет
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

// Английские приветствия (этап 11) — для тех, у кого язык английский; одно из трёх, случайно
export const GREETINGS_EN = [
  `<b>{name}, what's up, bro!</b> 🤝

How are you doing, my friend? Hope you got some sleep 😴

Here's your <b>free schedule</b> for the whole GUU — no subscriptions,
no SMS 🎁

📅 your group's classes for the day and week
🧑‍🏫 teachers and their ratings
🏛 buildings and free classrooms

Tap the button and pick your group 👇`,
  `<b>Hey {name}!</b> 👊 How's life? All good?
Here's the GUU schedule — free, from the heart ❤️ 👇`,
  `<b>Yo {name}!</b> 🫡
Being late because you couldn't find room ЛК-405 is so last century.
Now you've got the whole GUU schedule with a campus map — for free 🎁
Let's go 👇`,
]

const DEFAULTS: Settings = {
  greetings: DEFAULT_GREETINGS,
  maintenance: { on: false, text: 'Скоро вернёмся — обновляем расписание.' },
  notice: { on: false, id: 0, text: '' },
  channel: '',
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
    channel: typeof stored.channel === 'string' ? stored.channel : '',
  }
  cached = { at: Date.now(), settings }
  return settings
}

export async function saveSettings(env: Env, settings: Settings): Promise<void> {
  await env.KV.put(KEY, JSON.stringify(settings))
  cached = { at: Date.now(), settings }
}

// {имя} → имя (уже экранированное) жирным не делаем — жирность задаёт сам текст
export const renderGreeting = (template: string, name: string) => template.replaceAll('{имя}', name).replaceAll('{name}', name)

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
