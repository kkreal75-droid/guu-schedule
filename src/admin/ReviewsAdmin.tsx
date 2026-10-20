import { useCallback, useEffect, useState } from 'react'
import { Segmented } from '../components/Segmented'
import { confirmAction, haptic } from '../telegram'
import { adminApi, adminError, stamp, userName, type ReviewRow } from './api'
import { Loading, useFlash } from './common'

// «Админ-панель → Отзывы»: жалобы и лента всех отзывов о преподавателях с авторами.
// Удалить, удалить и забанить в отзывах, оставить (снять жалобы и вернуть скрытый).
type Tab = 'reports' | 'feed'

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

export function ReviewsAdmin() {
  const [tab, setTab] = useState<Tab>('reports')
  return (
    <div className="page-body">
      <Segmented
        label="Отзывы"
        value={tab}
        options={[
          { value: 'reports', label: 'Жалобы' },
          { value: 'feed', label: 'Все отзывы' },
        ]}
        onChange={setTab}
      />
      <ReviewList key={tab} reports={tab === 'reports'} />
    </div>
  )
}

function ReviewList({ reports }: { reports: boolean }) {
  const [items, setItems] = useState<ReviewRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [flash, notice] = useFlash()

  const load = useCallback(
    async (before?: number) => {
      try {
        const res = await adminApi.reviews(reports, before)
        setItems((prev) => (before && prev ? [...prev, ...res.reviews] : res.reviews))
        setHasMore(res.has_more)
      } catch (err) {
        flash(adminError(err))
      }
    },
    [reports, flash],
  )
  useEffect(() => void load(), [load])

  const done = (id: number, result: string) => {
    flash(result)
    if (id > 0) setItems((list) => list?.filter((r) => r.id !== id) ?? null)
  }

  if (!items) return <>{notice ?? <Loading />}</>
  return (
    <>
      {notice}
      {items.length === 0 && <p className="board-empty">{reports ? 'Жалоб нет 🎉' : 'Отзывов пока нет'}</p>}
      {items.map((r) => (
        <ReviewAdminRow key={r.id} r={r} onDone={done} keepable={reports || r.hidden === 1 || r.reports > 0} />
      ))}
      {hasMore && (
        <button type="button" className="button-secondary" onClick={() => load(items.at(-1)!.id)}>
          Показать ещё
        </button>
      )}
    </>
  )
}

function ReviewAdminRow({ r, onDone, keepable }: { r: ReviewRow; onDone: (id: number, result: string) => void; keepable: boolean }) {
  const [busy, setBusy] = useState(false)
  const act = async (action: 'del' | 'ban' | 'keep') => {
    const question = { del: 'Удалить отзыв?', ban: 'Удалить отзыв и забанить автора в отзывах навсегда?', keep: 'Оставить отзыв?' }[action]
    if (!(await confirmAction(question))) return
    setBusy(true)
    try {
      const { result } = await adminApi.reviewModerate(r.id, action)
      haptic('light')
      onDone(r.id, result)
    } catch (err) {
      onDone(-1, adminError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="admin-report">
      <div className="admin-msg-meta">
        <b>{r.teacher_name}</b> · {stars(r.rating)}
        {r.discipline ? ` · ${r.discipline}` : ''}
      </div>
      <div className="admin-msg-meta">
        {userName(r)} (id {r.user_id}){r.grp ? ` · ${r.grp}` : ''} · {stamp(r.created_at)}
        {r.updated_at > r.created_at ? ' · изменён' : ''}
        {r.reports ? ` · жалоб: ${r.reports}` : ''}
        {r.hidden ? ' · скрыт' : ''}
      </div>
      <div className="admin-msg-text">{r.text}</div>
      <div className="row-chips">
        <button type="button" className="chip chip-danger" disabled={busy} onClick={() => act('del')}>
          Удалить
        </button>
        <button type="button" className="chip chip-danger" disabled={busy} onClick={() => act('ban')}>
          Удалить и забанить
        </button>
        {keepable && (
          <button type="button" className="chip" disabled={busy} onClick={() => act('keep')}>
            Оставить
          </button>
        )}
      </div>
    </div>
  )
}
