import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useBackButton } from '../useBackButton'

const CLOSE_DRAG_PX = 80 // столько протянуть вниз, чтобы закрыть

// Окно снизу: затемнение, белый лист со скруглением сверху и «ручкой». Закрывается тапом мимо, свайпом вниз,
// кнопкой «Назад» Telegram и Escape; кнопки «Закрыть» нет. Открыта клавиатура — лист поднимается над ней.
export function Sheet({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const [keyboard, setKeyboard] = useState(0)

  useBackButton(onClose)

  useEffect(() => {
    // страница под окном не прокручивается
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // высота клавиатуры: насколько видимая часть экрана меньше окна
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // свайп вниз — только когда лист прокручен до верха (иначе это прокрутка содержимого)
  const onTouchStart = (e: TouchEvent) => {
    if ((sheet.current?.scrollTop ?? 0) > 0) return
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    const d = drag.current
    const el = sheet.current
    if (!d || !el) return
    d.dy = Math.max(0, e.touches[0].clientY - d.y)
    el.style.transition = 'none'
    el.style.transform = d.dy ? `translateY(${d.dy}px)` : ''
  }
  const onTouchEnd = () => {
    const d = drag.current
    const el = sheet.current
    drag.current = null
    if (!d || !el) return
    el.style.transition = ''
    if (d.dy > CLOSE_DRAG_PX) {
      el.style.transform = 'translateY(100%)'
      window.setTimeout(onClose, 160)
    } else el.style.transform = ''
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={sheet}
        className={`sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={keyboard ? { marginBottom: keyboard } : undefined}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <span className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  )
}
