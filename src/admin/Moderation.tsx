import { useEffect, useState } from 'react'
import type { BoardId } from '../board/api'
import { snapshotPng } from '../board/BoardCanvas'
import { Segmented } from '../components/Segmented'
import { Section } from '../components/Section'
import { confirmAction, haptic } from '../telegram'
import { BOARD_TITLES, adminApi, adminError, stamp, userName, type BoardMessageRow, type Snapshot } from './api'
import { Loading, useFlash, useLoad } from './common'

type Tab = 'reports' | 'feed' | 'canvas'

export function Moderation() {
  const [tab, setTab] = useState<Tab>('reports')
  return (
    <div className="page-body">
      <Segmented
        label="Модерация"
        value={tab}
        options={[
          { value: 'reports', label: 'Жалобы' },
          { value: 'feed', label: 'Лента' },
          { value: 'canvas', label: 'Холсты' },
        ]}
        onChange={setTab}
      />
      {tab === 'reports' ? <Reports /> : tab === 'feed' ? <Feed /> : <Canvases />}
    </div>
  )
}

function MessageRow({ m, onDone }: { m: BoardMessageRow; onDone: (id: number, result: string) => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (action: 'del' | 'ban' | 'ign') => {
    const question = { del: 'Удалить сообщение?', ban: 'Удалить и забанить автора на доске навсегда?', ign: 'Оставить сообщение?' }[action]
    if (!(await confirmAction(question))) return
    setBusy(true)
    try {
      const { result } = await adminApi.moderate(m.id, action)
      haptic('light')
      onDone(m.id, result)
    } catch (err) {
      onDone(-1, adminError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="admin-report">
      <div className="admin-msg-meta">
        «{BOARD_TITLES[m.board] ?? m.board}» · {m.alias} · <b>{userName(m)}</b> (id {m.user_id}) · {stamp(m.created_at)}
        {m.reports ? ` · жалоб: ${m.reports}` : ''}
        {m.hidden ? ' · скрыто' : ''}
      </div>
      <div className="admin-msg-text">{m.text}</div>
      <div className="row-chips">
        <button type="button" className="chip chip-danger" disabled={busy} onClick={() => act('del')}>
          Удалить
        </button>
        <button type="button" className="chip chip-danger" disabled={busy} onClick={() => act('ban')}>
          Удалить и забанить
        </button>
        {m.reports !== undefined && (
          <button type="button" className="chip" disabled={busy} onClick={() => act('ign')}>
            Игнорировать
          </button>
        )}
      </div>
    </div>
  )
}

function Reports() {
  const { data, setData, error } = useLoad(adminApi.reports)
  const [flash, notice] = useFlash()
  if (!data) return <Loading error={error ? adminError(error) : null} />
  const done = (id: number, result: string) => {
    flash(result)
    if (id > 0) setData({ reports: data.reports.filter((r) => r.id !== id) })
  }
  return (
    <>
      {notice}
      {data.reports.length === 0 && <p className="board-empty">Жалоб нет 🎉</p>}
      {data.reports.map((m) => (
        <MessageRow key={m.id} m={m} onDone={done} />
      ))}
    </>
  )
}

// лента общей доски (и старых сообщений бывших досок групп, пока их не удалит срок)
function Feed() {
  const [messages, setMessages] = useState<BoardMessageRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [flash, notice] = useFlash()

  useEffect(() => {
    adminApi.feed(null).then(
      (res) => {
        setMessages(res.messages)
        setHasMore(res.has_more)
      },
      (err) => flash(adminError(err)),
    )
  }, [flash])

  const more = async () => {
    if (!messages?.length) return
    try {
      const res = await adminApi.feed(null, messages.at(-1)!.id)
      setMessages([...messages, ...res.messages])
      setHasMore(res.has_more)
    } catch (err) {
      flash(adminError(err))
    }
  }
  const done = (id: number, result: string) => {
    flash(result)
    if (id > 0) setMessages((list) => list?.filter((m) => m.id !== id) ?? null)
  }

  return (
    <>
      {notice}
      {!messages ? (
        <Loading />
      ) : (
        <>
          {messages.length === 0 && <p className="board-empty">Сообщений нет</p>}
          {messages.map((m) => (
            <MessageRow key={m.id} m={{ ...m, reports: undefined }} onDone={done} />
          ))}
          {hasMore && (
            <button type="button" className="button-secondary" onClick={more}>
              Показать ещё
            </button>
          )}
        </>
      )}
    </>
  )
}

function Canvases() {
  const { data, reload } = useLoad(adminApi.snapshots)
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<{ id: number; url: string } | null>(null)
  const [flash, notice] = useFlash()

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url)
    },
    [image],
  )

  const clear = async (board: BoardId) => {
    if (!(await confirmAction('Очистить холст для всех? Снимок сохранится в архиве.'))) return
    setBusy(true)
    try {
      const { strokes } = await adminApi.strokes(board)
      if (!strokes.length) return flash('Холст и так пустой')
      const res = await adminApi.clear(board, snapshotPng(strokes))
      flash(`Очищено, снимок №${res.snapshot} в архиве`)
      reload()
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const show = async (snap: Snapshot) => {
    if (image?.id === snap.id) return setImage(null)
    try {
      setImage({ id: snap.id, url: URL.createObjectURL(await adminApi.snapshot(snap.id)) })
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <>
      <button type="button" className="button-secondary button-danger" disabled={busy} onClick={() => clear('all')}>
        Очистить холст
      </button>
      {notice}
      <Section title="Архив снимков" footer="Снимок делается перед каждой очисткой и приходит вам в чат с ботом.">
        {!data && <div className="row row-text">Загружаю…</div>}
        {data?.snapshots.length === 0 && <div className="row row-text">Пока пусто</div>}
        {data?.snapshots.map((s) => (
          <div key={s.id}>
            <button type="button" className="row row-btn" onClick={() => show(s)}>
              <span>
                №{s.id} · «{BOARD_TITLES[s.board] ?? s.board}»
              </span>
              <span className="row-value">
                {stamp(s.created_at)} · {s.strokes} штр.
              </span>
            </button>
            {image?.id === s.id && <img className="snapshot-img" src={image.url} alt={`Снимок №${s.id}`} />}
          </div>
        ))}
      </Section>
    </>
  )
}
