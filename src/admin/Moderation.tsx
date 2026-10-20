import { useEffect, useState } from 'react'
import { Segmented } from '../components/Segmented'
import { confirmAction, haptic } from '../telegram'
import { adminApi, adminError, stamp, userName, type BoardMessageRow } from './api'
import { Loading, useFlash, useLoad } from './common'

type Tab = 'reports' | 'feed'

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
        ]}
        onChange={setTab}
      />
      {tab === 'reports' ? <Reports /> : <Feed />}
    </div>
  )
}

function MessageRow({ m, onDone }: { m: BoardMessageRow; onDone: (id: number, result: string) => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (action: 'del' | 'ban' | 'ign') => {
    const question = { del: 'Удалить сообщение?', ban: 'Удалить и забанить автора в чате навсегда?', ign: 'Оставить сообщение?' }[action]
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
        {m.alias}
        {m.origin ? ` · ${m.origin}` : ''} · <b>{userName(m)}</b> (id {m.user_id}) · {stamp(m.created_at)}
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

// лента чата с настоящими авторами
function Feed() {
  const [messages, setMessages] = useState<BoardMessageRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [flash, notice] = useFlash()

  useEffect(() => {
    adminApi.feed().then(
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
      const res = await adminApi.feed(messages.at(-1)!.id)
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
