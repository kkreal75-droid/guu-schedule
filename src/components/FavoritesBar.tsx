import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PlusIcon, StarFillIcon } from '../icons'
import { haptic } from '../telegram'
import { t } from '../i18n'

// Лента над расписанием (этап 12): ★ — своё расписание (группа или своё ФИО у преподавателя), дальше избранное —
// группы и преподаватели вперемешку; прокручивается, если не влезает; «+» — найти и добавить.
// Подержать чип ~0,4 с — он «поднимется»: потянуть — переставить, отпустить на месте — убрать из избранного.
type Props = {
  value: string // что показано сейчас
  home: string
  items: string[] // избранное по порядку (без своего)
  label: (id: string) => string // «МБ(МП) 1-2», «Королева Н.Ш.»
  onChange: (id: string) => void
  onAdd?: () => void
  onReorder?: (list: string[]) => void
  onRemove?: (id: string) => void
}

const HOLD_MS = 400
const isTeacher = (id: string) => id.startsWith('t-')

type Drag = { id: string; pointerId: number; x0: number; y0: number; timer: number; lifted: boolean; moved: boolean; el: HTMLElement }

export function FavoritesBar({ value, home, items, label, onChange, onAdd, onReorder, onRemove }: Props) {
  const [order, setOrder] = useState(items)
  const key = items.join('|')
  useEffect(() => setOrder(items), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const [lifted, setLifted] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const chips = useRef(new Map<string, HTMLElement>())
  const skipClickUntil = useRef(0) // после перетаскивания браузер может прислать click — его не считаем
  const editable = Boolean(onReorder || onRemove)

  // пока чип поднят, лента не прокручивается (иначе палец тянет ленту, а не чип)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const block = (e: TouchEvent) => drag.current?.lifted && e.preventDefault()
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  const cancel = () => {
    if (drag.current) window.clearTimeout(drag.current.timer)
    drag.current = null
    setLifted(null)
  }

  const onDown = (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable || e.button !== 0) return
    const state: Drag = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, timer: 0, lifted: false, moved: false, el: e.currentTarget }
    state.timer = window.setTimeout(() => {
      state.lifted = true
      try {
        state.el.setPointerCapture(state.pointerId)
      } catch {
        // палец уже отпустили
      }
      setLifted(id)
      haptic('light')
    }, HOLD_MS)
    drag.current = state
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) cancel() // это прокрутка ленты
      return
    }
    if (Math.abs(e.clientX - d.x0) > 8) d.moved = true
    // куда встать: перед первым чипом, чей центр правее пальца
    const others = order.filter((x) => x !== d.id)
    let index = others.length
    for (let i = 0; i < others.length; i++) {
      const r = chips.current.get(others[i])?.getBoundingClientRect()
      if (r && e.clientX < r.left + r.width / 2) {
        index = i
        break
      }
    }
    const next = [...others.slice(0, index), d.id, ...others.slice(index)]
    if (next.join('|') !== order.join('|')) {
      setOrder(next)
      haptic()
    }
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    window.clearTimeout(d.timer)
    drag.current = null
    if (!d.lifted) return
    skipClickUntil.current = Date.now() + 400
    setLifted(null)
    if (d.moved) {
      if (order.join('|') !== items.join('|')) onReorder?.(order)
    } else onRemove?.(d.id)
  }

  const chip = (id: string, own: boolean) => (
    <button
      key={id}
      ref={(el) => {
        if (el) chips.current.set(id, el)
        else chips.current.delete(id)
      }}
      type="button"
      role="radio"
      aria-checked={id === value}
      className="group-chip fav-chip"
      data-lifted={lifted === id || undefined}
      onPointerDown={own ? undefined : onDown(id)}
      onPointerMove={own ? undefined : onMove}
      onPointerUp={own ? undefined : onUp}
      onPointerCancel={own ? undefined : cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (Date.now() < skipClickUntil.current) return
        if (id === value) return
        haptic()
        onChange(id)
      }}
    >
      {own && <StarFillIcon className="group-chip-star" aria-label={t('своё расписание')} />}
      <span lang={isTeacher(id) ? undefined : 'ru'}>{label(id)}</span>
    </button>
  )

  return (
    <div className="chips-bar">
      <div ref={scroller} className="chips-scroll" role="radiogroup" aria-label={t('Избранное')} data-dragging={lifted ? true : undefined}>
        {chip(home, true)}
        {order.map((id) => chip(id, false))}
        {onAdd && (
          <button type="button" className="group-chip group-chip-add" aria-label={t('Добавить в избранное')} onClick={onAdd}>
            <PlusIcon />
          </button>
        )}
      </div>
    </div>
  )
}
