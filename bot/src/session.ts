// «📚 Опубликовано расписание сессии» (этап 8.2). update.py кладёт на сайт data/session_status.json: у каких
// групп есть сессия ТЕКУЩЕГО учебного года (прошлогодние файлы guu.ru — архив, их группам не показываем).
// Cron раз в 10 минут сверяет список с KV `session-notified` (пишется, только когда появились новые группы)
// и запускает обычную рассылку пользователям этих групп — с кнопкой, которая открывает экран сессии.
import { normalizeGroup } from '../../shared/groups'
import { systemBroadcast } from './broadcast'
import { tr } from './i18n'
import { sendMessage } from './telegram'

type Status = { current_year: string; groups: string[] }

const KEY = 'session-notified'
const TEXT = '📚 Опубликовано расписание сессии — смотри в приложении'
const BUTTON = 'Открыть расписание сессии'

export async function notifySessions(env: Env): Promise<number> {
  const res = await fetch(new URL('data/session_status.json', env.WEBAPP_URL).toString(), {
    cf: { cacheTtl: 60, cacheEverything: true },
  })
  if (res.status === 404) return 1 // сайт ещё без файла
  if (!res.ok) throw new Error(`session_status.json: HTTP ${res.status}`)
  const status = (await res.json()) as Status
  if (!status.groups?.length) return 1
  const saved = await env.KV.get<{ year: string; groups: string[] }>(KEY, 'json')
  const known = new Set(saved?.year === status.current_year ? saved.groups : [])
  const fresh = status.groups.filter((g) => normalizeGroup(g) === g && !known.has(g))
  if (!fresh.length) return 2
  // сначала помним, кому уже сказали: упадёт рассылка — владелец получит ошибку, дублей не будет
  await env.KV.put(KEY, JSON.stringify({ year: status.current_year, groups: [...known, ...fresh] }))
  const url = new URL(env.WEBAPP_URL)
  url.searchParams.set('open', 'session')
  // английским получателям — по-английски (drainBroadcasts выбирает текст по языку)
  const { id, total } = await systemBroadcast(env, {
    text: TEXT,
    text_en: tr('en', TEXT),
    button: { text: BUTTON, text_en: tr('en', BUTTON), url: url.toString() },
    audience: { groups: fresh },
  })
  await sendMessage(
    env,
    Number(env.OWNER_ID),
    `📚 На guu.ru появилась сессия ${status.current_year} — групп: <b>${fresh.length}</b>. Рассылка #${id}, получателей: <b>${total}</b>.`,
  )
  return 6
}
