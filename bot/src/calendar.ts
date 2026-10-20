// Живой календарь: подписка по ссылке /cal/<токен>.ics (Apple, Google и др.).
// Токен — случайный; «Отключить» удаляет его, и старая ссылка перестаёт работать.
import { dayLessons, shortWhen } from '../../shared/edits-core'
import { isoFromDay } from '../../shared/schedule-core'
import { MB_IDS, normalizeGroup, shortName } from '../../shared/groups'
import { json, readApi } from './api'
import { loadGroupFile, loadTimetable, type BotTimetable } from './schedule'
import { userSubgroups } from './db'
import { economyMode } from './usage'

type TokenRow = { token: string; user_id: number; grp: string; created_at: number } // grp — id группы

// UID событий и имя файла: у МБ — «1-1», как раньше (иначе календари задвоят пары), у остальных — id
const uidPrefix = (group: string) => shortName(group, group)

// ---------- .ics ----------

const encoder = new TextEncoder()

// RFC 5545: экранируем \ ; , и переводы строк
const escapeText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// Строки длиннее 75 октетов переносим (CRLF + пробел), не разрывая символы UTF-8
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const localStamp = (iso: string, hhmm: string) => `${iso.replace(/-/g, '')}T${hhmm.replace(':', '')}00`

function utcStamp(at: string | undefined): string {
  const date = at ? new Date(at) : new Date(Date.UTC(2026, 7, 31))
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

// короткий стабильный хэш (FNV-1a) — для UID, чтобы календарь не плодил дубли
function hash(text: string): string {
  let h = 0x811c9dc5
  for (const char of text) {
    h ^= char.codePointAt(0)!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const MOSCOW_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Moscow',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0300',
  'TZNAME:MSK',
  'END:STANDARD',
  'END:VTIMEZONE',
]

// .ics одной группы на весь семестр — с правками (отмена → STATUS:CANCELLED, перенос, добавленные пары)
// и подгруппами владельца ссылки (mine: чужие пары подгрупп не показываем)
export function buildIcs(tt: BotTimetable, group: string, mine: number[] | null = null): string {
  const stamp = utcStamp(tt.schedule.updated_at)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//guu-schedule//Расписание ГУУ//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`Расписание ${tt.nameOf(group)}`)}`,
    'X-WR-TIMEZONE:Europe/Moscow',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...MOSCOW_TZ,
  ]
  for (let week = 1; week <= tt.maxWeek; week++) {
    for (let weekday = 0; weekday < 6; weekday++) {
      const day = tt.dayOf(week, weekday)
      const iso = isoFromDay(day)
      const view = dayLessons(tt, group, day, tt.extras, mine)
      for (const lesson of view.lessons) {
        const status = lesson.cancel
          ? `Отменена${lesson.cancel.text ? `: ${lesson.cancel.text}` : ''}`
          : lesson.movedTo
            ? `Перенесена на ${shortWhen(lesson.movedTo.date, lesson.movedTo.start)}`
            : lesson.movedFrom
              ? `Перенос с ${shortWhen(lesson.movedFrom.date, lesson.movedFrom.start)}`
              : lesson.added
                ? 'Добавлена'
                : null
        const pair = lesson.pair ?? (lesson.added || lesson.movedFrom ? null : tt.pairNumber(lesson))
        const description = [
          ...[status, ...view.notes, ...lesson.notes].filter(Boolean).map((n) => `⚠️ ${n}`),
          [lesson.kind, lesson.teachers?.join(', ') ?? lesson.teacher, lesson.subgroup?.name, pair ? `${pair} пара` : null]
            .filter(Boolean)
            .join(' · '),
        ].join('\n')
        lines.push(
          'BEGIN:VEVENT',
          `UID:${uidPrefix(group)}-${iso}-${lesson.start.replace(':', '')}-${hash(lesson.subject)}@guu-schedule-bot`,
          `DTSTAMP:${stamp}`,
          `DTSTART;TZID=Europe/Moscow:${localStamp(iso, lesson.start)}`,
          `DTEND;TZID=Europe/Moscow:${localStamp(iso, lesson.end)}`,
          `SUMMARY:${escapeText(lesson.subject)}`,
          ...(lesson.room ? [`LOCATION:${escapeText(lesson.room)}`] : []),
          `DESCRIPTION:${escapeText(description)}`,
          ...(lesson.cancel || lesson.movedTo ? ['STATUS:CANCELLED'] : ['STATUS:CONFIRMED']),
          'END:VEVENT',
        )
      }
    }
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ---------- ссылка и токены ----------

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const feedUrl = (origin: string, token: string) => `${origin}/cal/${token}.ics`

function status(origin: string, row: TokenRow | null) {
  return row
    ? { ok: true, connected: true, url: feedUrl(origin, row.token), group: normalizeGroup(row.grp) ?? row.grp }
    : { ok: true, connected: false }
}

// POST /cal/status | /cal/connect {group} | /cal/disconnect — из мини-приложения
export async function handleCalendarApi(env: Env, request: Request, action: string): Promise<Response> {
  const req = await readApi<{ group?: string }>(env, request, { write: action !== 'status' })
  if (req instanceof Response) return req
  const origin = new URL(request.url).origin
  const userId = req.profile.id
  const current = await env.DB.prepare('SELECT * FROM calendar_tokens WHERE user_id = ?').bind(userId).first<TokenRow>()

  if (action === 'status') return json(status(origin, current))
  if (action === 'disconnect') {
    if (current) icsCache.delete(current.token)
    await env.DB.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').bind(userId).run()
    return json({ ok: true, connected: false })
  }
  if (action === 'connect') {
    // группа из приложения (старые версии присылают имя «МБ(МП) 1-1»); такой нет на сайте — 400
    const group = normalizeGroup(req.body.group) ?? MB_IDS[0]
    if (!(await loadGroupFile(env, group))) return json({ ok: false, error: 'group' }, 400)
    if (current) {
      icsCache.delete(current.token)
      await env.DB.prepare('UPDATE calendar_tokens SET grp = ? WHERE user_id = ?').bind(group, userId).run()
      return json(status(origin, { ...current, grp: group }))
    }
    const row: TokenRow = { token: newToken(), user_id: userId, grp: group, created_at: Date.now() }
    await env.DB.prepare('INSERT INTO calendar_tokens (token, user_id, grp, created_at) VALUES (?, ?, ?, ?)')
      .bind(row.token, row.user_id, row.grp, row.created_at)
      .run()
    return json(status(origin, row))
  }
  return json({ ok: false, error: 'not found' }, 404)
}

// Готовый .ics в памяти изолята на 10 минут: Apple и Google спрашивают часто, а календарь меняется редко.
// «Отключить» убирает ссылку из кэша этого изолята; в остальных она умрёт сама за ≤ 10 минут.
const ICS_TTL_MS = 10 * 60_000
const icsCache = new Map<string, { at: number; ics: string; group: string }>()
const FETCH_MARK_MS = 60 * 60_000 // last_fetch_at обновляем не чаще раза в час — меньше записей в D1

// GET /cal/<токен>.ics — забирают сами календари
export async function handleIcs(env: Env, ctx: ExecutionContext, token: string): Promise<Response> {
  let hit = icsCache.get(token)
  // режим экономии (лимиты на исходе) — календари из кэша до часа
  if (!hit || Date.now() - hit.at > (economyMode() ? 6 * ICS_TTL_MS : ICS_TTL_MS)) {
    const row = await env.DB.prepare('SELECT * FROM calendar_tokens WHERE token = ?').bind(token).first<TokenRow>()
    if (!row) {
      icsCache.delete(token)
      return new Response('Календарь отключён', { status: 404 })
    }
    const now = Date.now()
    ctx.waitUntil(
      env.DB.prepare(
        `UPDATE calendar_tokens SET last_fetch_at = ?1, fetch_count = fetch_count + 1
         WHERE token = ?2 AND (last_fetch_at IS NULL OR last_fetch_at < ?3)`,
      )
        .bind(now, token, now - FETCH_MARK_MS)
        .run(),
    )
    const group = normalizeGroup(row.grp) ?? row.grp
    const [tt, mine] = await Promise.all([loadTimetable(env, [group]), userSubgroups(env.DB, row.user_id)])
    hit = { at: now, ics: buildIcs(tt, group, mine), group }
    icsCache.set(token, hit)
    if (icsCache.size > 300) icsCache.delete(icsCache.keys().next().value!)
  }
  const { ics, group } = hit
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="guu-${uidPrefix(group)}.ics"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}

// GET /cal/<токен>/apple — страница для iPhone. Telegram открывает из мини-приложения только
// http(s)-ссылки, поэтому кнопка «Apple Календарь» ведёт сюда, а страница уже открывает
// webcal:// — Календарь предлагает подписаться.
export async function handleAppleSubscribe(env: Env, request: Request, token: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT grp FROM calendar_tokens WHERE token = ?').bind(token).first<{ grp: string }>()
  const html = (body: string, status = 200) =>
    new Response(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Подписка на расписание</title>
<style>
body{margin:0;padding:40px 20px;font:17px/1.4 -apple-system,system-ui,sans-serif;text-align:center;background:#f2f2f7;color:#111}
h1{font-size:22px;margin:0 0 12px}p{color:#666;margin:8px 0}
a.btn{display:inline-block;margin:20px 0 8px;padding:14px 24px;border-radius:12px;background:#007aff;color:#fff;font-weight:600;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#000;color:#fff}p{color:#999}}
</style></head><body>${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    )
  if (!row) return html('<h1>Календарь отключён</h1><p>Подключите его заново в приложении: Ещё → Календарь на телефоне.</p>', 404)
  const webcal = feedUrl(new URL(request.url).origin, token).replace(/^https?:/, 'webcal:')
  const group = normalizeGroup(row.grp) ?? row.grp
  const title = (await loadGroupFile(env, group).catch(() => null))?.name ?? group
  return html(`<h1>📅 Расписание ${escapeHtmlText(title)}</h1>
<p>Сейчас откроется Календарь — нажмите «Подписаться».</p>
<a class="btn" href="${webcal}">Подписаться в Календаре</a>
<p>Если ничего не открылось — нажмите кнопку.</p>
<script>location.href = ${JSON.stringify(webcal)}</script>`)
}

const escapeHtmlText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
