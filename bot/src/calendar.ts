// Живой календарь: подписка по ссылке /cal/<токен>.ics (Apple, Google и др.).
// Токен — случайный; «Отключить» удаляет его, и старая ссылка перестаёт работать.
import type { Lesson, Timetable } from '../../shared/schedule-core'
import { isoFromDay } from '../../shared/schedule-core'
import { json, readApi } from './api'
import { GROUPS, shortGroup } from './db'
import { loadTimetable } from './schedule'

// Ручная правка из админ-панели (edits.ts): отменённая пара или пометка (start null — ко всему дню)
export type CalendarEdit = { group: string; date: string; start: string | null; kind: 'cancel' | 'note'; text: string }

type TokenRow = { token: string; user_id: number; grp: string; created_at: number }

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

export function buildIcs(tt: Timetable, group: string, edits: CalendarEdit[] = []): string {
  const stamp = utcStamp(tt.schedule.updated_at)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//guu-schedule//Расписание ГУУ//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`Расписание ${group}`)}`,
    'X-WR-TIMEZONE:Europe/Moscow',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...MOSCOW_TZ,
  ]
  const lessons: Lesson[] = tt.schedule.lessons.filter((l) => l.group === group)
  for (const lesson of lessons) {
    for (const week of lesson.weeks) {
      if (!tt.inSemester(week)) continue
      const iso = isoFromDay(tt.dayOf(week, lesson.weekday))
      const related = edits.filter((e) => e.group === group && e.date === iso && (e.start === lesson.start || e.start === null))
      const cancelled = related.some((e) => e.kind === 'cancel' && e.start === lesson.start)
      const notes = related.map((e) => (e.kind === 'cancel' ? `Отменена${e.text ? `: ${e.text}` : ''}` : e.text)).filter(Boolean)
      const description = [
        ...notes.map((n) => `⚠️ ${n}`),
        [lesson.kind, lesson.teacher, `${tt.pairNumber(lesson.start)} пара`].filter(Boolean).join(' · '),
      ].join('\n')
      lines.push(
        'BEGIN:VEVENT',
        `UID:${shortGroup(group)}-${iso}-${lesson.start.replace(':', '')}-${hash(lesson.subject)}@guu-schedule-bot`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Moscow:${localStamp(iso, lesson.start)}`,
        `DTEND;TZID=Europe/Moscow:${localStamp(iso, lesson.end)}`,
        `SUMMARY:${escapeText(lesson.subject)}`,
        ...(lesson.room ? [`LOCATION:${escapeText(lesson.room)}`] : []),
        `DESCRIPTION:${escapeText(description)}`,
        ...(cancelled ? ['STATUS:CANCELLED'] : ['STATUS:CONFIRMED']),
        'END:VEVENT',
      )
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
  return row ? { ok: true, connected: true, url: feedUrl(origin, row.token), group: row.grp } : { ok: true, connected: false }
}

// POST /cal/status | /cal/connect {group} | /cal/disconnect — из мини-приложения
export async function handleCalendarApi(env: Env, request: Request, action: string): Promise<Response> {
  const req = await readApi<{ group?: string }>(env, request)
  if (req instanceof Response) return req
  const origin = new URL(request.url).origin
  const userId = req.profile.id
  const current = await env.DB.prepare('SELECT * FROM calendar_tokens WHERE user_id = ?').bind(userId).first<TokenRow>()

  if (action === 'status') return json(status(origin, current))
  if (action === 'disconnect') {
    await env.DB.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').bind(userId).run()
    return json({ ok: true, connected: false })
  }
  if (action === 'connect') {
    const group = (GROUPS as readonly string[]).includes(req.body.group ?? '') ? req.body.group! : GROUPS[0]
    if (current) {
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

// GET /cal/<токен>.ics — забирают сами календари
export async function handleIcs(env: Env, ctx: ExecutionContext, token: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM calendar_tokens WHERE token = ?').bind(token).first<TokenRow>()
  if (!row) return new Response('Календарь отключён', { status: 404 })
  ctx.waitUntil(
    env.DB.prepare('UPDATE calendar_tokens SET last_fetch_at = ?, fetch_count = fetch_count + 1 WHERE token = ?')
      .bind(Date.now(), token)
      .run(),
  )
  const tt = await loadTimetable(env)
  const ics = buildIcs(tt, row.grp, tt.edits)
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="guu-${shortGroup(row.grp)}.ics"`,
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
  return html(`<h1>📅 Расписание ${escapeHtmlText(row.grp)}</h1>
<p>Сейчас откроется Календарь — нажмите «Подписаться».</p>
<a class="btn" href="${webcal}">Подписаться в Календаре</a>
<p>Если ничего не открылось — нажмите кнопку.</p>
<script>location.href = ${JSON.stringify(webcal)}</script>`)
}

const escapeHtmlText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
