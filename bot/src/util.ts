import { formatStamp } from '../../shared/format-core'
import type { TgEntity } from './telegram'

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// «19.10 16:07» по Москве
export const formatMsk = (ms: number) => formatStamp(ms) ?? '—'

// «19.10.2026 16:07» по Москве — для CSV
export function formatMskFull(ms: number | null): string {
  if (!ms) return ''
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

// ---------- CSV для Excel: UTF-8 с BOM, разделитель «;» ----------

export function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n'
}

// ---------- форматирование Telegram → HTML ----------
// Если админ выделил текст средствами Telegram (жирный, ссылка…), приходят entities, а не теги.
// Переводим их в HTML, чтобы рассылка выглядела так же. Смещения — в UTF-16, как и строки JS.

function tagsFor(entity: TgEntity): [string, string] | null {
  switch (entity.type) {
    case 'bold':
      return ['<b>', '</b>']
    case 'italic':
      return ['<i>', '</i>']
    case 'underline':
      return ['<u>', '</u>']
    case 'strikethrough':
      return ['<s>', '</s>']
    case 'spoiler':
      return ['<tg-spoiler>', '</tg-spoiler>']
    case 'code':
      return ['<code>', '</code>']
    case 'pre':
      return entity.language
        ? [`<pre><code class="language-${escapeHtml(entity.language)}">`, '</code></pre>']
        : ['<pre>', '</pre>']
    case 'blockquote':
      return ['<blockquote>', '</blockquote>']
    case 'expandable_blockquote':
      return ['<blockquote expandable>', '</blockquote>']
    case 'text_link':
      return [`<a href="${escapeHtml(entity.url ?? '')}">`, '</a>']
    case 'text_mention':
      return entity.user ? [`<a href="tg://user?id=${entity.user.id}">`, '</a>'] : null
    case 'custom_emoji':
      return [`<tg-emoji emoji-id="${entity.custom_emoji_id}">`, '</tg-emoji>']
    default:
      return null // упоминания, ссылки, хэштеги Telegram распознает сам
  }
}

export const hasFormatting = (entities: TgEntity[] = []) => entities.some((e) => tagsFor(e) !== null)

// text и entities — после отрезания команды (смещения уже сдвинуты)
export function entitiesToHtml(text: string, entities: TgEntity[]): string {
  type Mark = { pos: number; open: boolean; len: number; html: string }
  const marks: Mark[] = []
  for (const entity of entities) {
    const tags = tagsFor(entity)
    if (!tags || entity.length <= 0) continue
    marks.push({ pos: entity.offset, open: true, len: entity.length, html: tags[0] })
    marks.push({ pos: entity.offset + entity.length, open: false, len: entity.length, html: tags[1] })
  }
  // в одной позиции: сначала закрываем (внутренние раньше внешних), потом открываем (внешние раньше)
  marks.sort((a, b) => a.pos - b.pos || Number(a.open) - Number(b.open) || (a.open ? b.len - a.len : a.len - b.len))
  let html = ''
  let at = 0
  for (const mark of marks) {
    html += escapeHtml(text.slice(at, mark.pos)) + mark.html
    at = mark.pos
  }
  return html + escapeHtml(text.slice(at))
}

// Отрезает «/команда » от текста и сдвигает entities
export function stripCommand(text: string, entities: TgEntity[] = []): { text: string; entities: TgEntity[] } {
  const match = text.match(/^\/\S+\s*/)
  const cut = match ? match[0].length : 0
  return {
    text: text.slice(cut),
    entities: entities
      .filter((e) => e.offset >= cut)
      .map((e) => ({ ...e, offset: e.offset - cut })),
  }
}
