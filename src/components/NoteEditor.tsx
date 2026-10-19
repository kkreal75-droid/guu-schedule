import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NOTE_MAX } from '../notes'
import { haptic, supports, tg } from '../telegram'

export type NoteTarget = {
  key: string
  title: string // «Заметка к паре»
  subtitle: string // предмет / дата и время
}

type Props = {
  target: NoteTarget
  initial: string
  // закрытие любым способом сохраняет текст; пустой текст = удалить заметку
  onClose: (text: string) => void
}

export function NoteEditor({ target, initial, onClose }: Props) {
  const [text, setText] = useState(initial)
  const close = () => onClose(text)

  // пока шторка открыта, страница под ней не прокручивается
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // системная кнопка «Назад» в шапке Telegram
  useEffect(() => {
    if (!supports('6.1')) return
    tg!.BackButton.show()
    return () => {
      tg!.BackButton.hide()
    }
  }, [])

  useEffect(() => {
    if (supports('6.1')) tg!.BackButton.onClick(close)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      if (supports('6.1')) tg!.BackButton.offClick(close)
      window.removeEventListener('keydown', onKey)
    }
  })

  return createPortal(
    <div className="sheet-backdrop" onClick={close}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={target.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div className="sheet-heading">
            <div className="sheet-title">{target.title}</div>
            <div className="sheet-sub">{target.subtitle}</div>
          </div>
          <button type="button" className="sheet-done" onClick={close}>
            Готово
          </button>
        </div>

        <textarea
          className="sheet-input"
          value={text}
          maxLength={NOTE_MAX}
          rows={6}
          autoFocus
          placeholder="Домашка, что взять с собой, перенос пары…"
          onChange={(e) => setText(e.target.value)}
        />

        <div className="sheet-foot">
          <span className="sheet-hint">
            {text.length > NOTE_MAX - 300 ? `${text.length} / ${NOTE_MAX}` : 'Сохранится при закрытии'}
          </span>
          {(initial || text) && (
            <button
              type="button"
              className="sheet-delete"
              onClick={() => {
                haptic('light')
                onClose('')
              }}
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
