import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Segmented } from '../components/Segmented'
import { Section } from '../components/Section'
import { confirmAction, haptic } from '../telegram'
import { adminApi, adminError, stamp, type Audience, type BroadcastRow } from './api'
import { Loading, useFlash, useLoad } from './common'

const AUDIENCE: Record<Audience, string> = { all: 'Всем', '1-1': '1-1', '1-2': '1-2' }
const TAGS: Record<string, string> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', code: 'code', pre: 'pre', blockquote: 'blockquote' }

// Предпросмотр HTML как в Telegram — только разрешённые теги, без выполнения чего-либо
// (DOMParser разбирает в отдельный документ, скрипты там не запускаются)
function renderHtml(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(`<body>${html.replace(/\n/g, '<br>')}</body>`, 'text/html')
  const walk = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof Element)) return null
    const children = [...node.childNodes].map(walk)
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') return <br key={key} />
    if (tag === 'a') return <span key={key} className="preview-link">{children}</span>
    if (tag === 'tg-spoiler') return <span key={key} className="preview-spoiler">{children}</span>
    const Tag = TAGS[tag] as keyof React.JSX.IntrinsicElements | undefined
    return Tag ? <Tag key={key}>{children}</Tag> : <Fragment key={key}>{children}</Fragment>
  }
  return [...doc.body.childNodes].map(walk)
}

// Фото уменьшаем до 1600 px и сжимаем в JPEG — быстрее загрузка, Telegram всё равно пережмёт
async function compress(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function statusText(row: BroadcastRow) {
  switch (row.status) {
    case 'draft':
      return 'черновик'
    case 'cancelled':
      return 'отменена'
    case 'sending':
      return `идёт ${row.delivered + row.blocked + row.failed}/${row.total}`
    default:
      return `✅ ${row.delivered} · 🚫 ${row.blocked} · ⚠️ ${row.failed}`
  }
}

export function BroadcastAdmin() {
  const { data, reload } = useLoad(adminApi.broadcastInfo)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [audience, setAudience] = useState<Audience>('all')
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()
  const fileInput = useRef<HTMLInputElement>(null)

  if (!data) return <Loading />
  const limit = photo ? 1024 : 4096

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    try {
      setPhoto(await compress(file))
    } catch {
      flash('Не получилось открыть фото')
    }
  }

  const send = async (to: Audience | null) => {
    if (to && !(await confirmAction(`Отправить рассылку: ${AUDIENCE[to].toLowerCase()} — ${data.counts[to]} получателей?`))) return
    setBusy(true)
    try {
      const res = await adminApi.broadcast(text, photo, to)
      haptic('light')
      if (to) {
        flash(`Рассылка #${res.id} пошла: ${res.total} получателей (+ копия вам). Отчёт придёт в бот.`)
        setText('')
        setPhoto(null)
        reload()
      } else {
        flash('Предпросмотр отправлен вам в чат с ботом')
      }
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-body">
      <textarea
        className="input textarea"
        rows={6}
        placeholder="Текст рассылки"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="section-footer">
        Можно HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;a href="…"&gt;ссылка&lt;/a&gt;. {text.length}/{limit}
      </p>

      <div className="row-chips">
        <button type="button" className="chip" onClick={() => fileInput.current?.click()}>
          {photo ? 'Другое фото' : '🖼 Добавить фото'}
        </button>
        {photo && (
          <button type="button" className="chip" onClick={() => setPhoto(null)}>
            Убрать фото
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
      </div>

      {(text.trim() || photo) && (
        <Section title="Предпросмотр">
          <div className="preview-bubble">
            {photo && <img className="preview-photo" src={photo} alt="" />}
            {text.trim() && <div className="preview-text">{renderHtml(text)}</div>}
          </div>
        </Section>
      )}

      <Segmented
        label="Кому"
        value={audience}
        options={(Object.keys(AUDIENCE) as Audience[]).map((a) => ({ value: a, label: `${AUDIENCE[a]} (${data.counts[a]})` }))}
        onChange={setAudience}
      />
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy || (!text.trim() && !photo)} onClick={() => send(null)}>
          Прислать себе
        </button>
        <button type="button" className="button-primary" disabled={busy || (!text.trim() && !photo) || text.length > limit} onClick={() => send(audience)}>
          Отправить
        </button>
      </div>
      {notice}

      <Section title="История" footer="Получатели — кто писал боту, не заблокировал его и не забанен.">
        {data.history.length === 0 && <div className="row row-text">Рассылок ещё не было</div>}
        {data.history.map((row) => (
          <div key={row.id} className="row admin-msg">
            <div className="admin-msg-body">
              <div className="admin-msg-meta">
                #{row.id} · {stamp(row.created_at)} · {row.audience ? AUDIENCE[row.audience] : '—'} · {statusText(row)}
                {row.photo ? ' · 🖼' : ''}
              </div>
              <div className="admin-msg-text">{row.text.replace(/<[^>]+>/g, '').slice(0, 160) || 'без текста'}</div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  )
}
