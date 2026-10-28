import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTE_MAX } from '../notes'
import { haptic } from '../telegram'
import { Sheet } from './Sheet'
import { t } from '../i18n'

export type NoteTarget = {
  key: string
  title: string // «Заметка к паре» / «Заметка к дню»
  subtitle: string // «Макроэкономика · пятница, 10:40» / «Пятница, 23 октября»
}

type Props = {
  target: NoteTarget
  initial: string
  // закрытие любым способом сохраняет текст; пустой текст = удалить заметку
  onClose: (text: string) => void
}

// Заметка — окно снизу: серое поле, «Сохранится при закрытии», красная «Готово»
export function NoteEditor({ target, initial, onClose }: Props) {
  const [text, setText] = useState(initial)
  // закрыть — с последним текстом (функция не меняется от нажатия к нажатию: окно не переподписывается)
  const latest = useRef({ text, onClose })
  useEffect(() => {
    latest.current = { text, onClose }
  })
  const close = useCallback(() => latest.current.onClose(latest.current.text), [])

  return (
    <Sheet label={target.title} onClose={close}>
      <h2 className="sheet-title">{target.title}</h2>
      <p className="sheet-sub">{target.subtitle}</p>
      <textarea
        className="input textarea note-input"
        value={text}
        maxLength={NOTE_MAX}
        rows={6}
        autoFocus
        placeholder={t('Домашка, что взять с собой, перенос пары…')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="note-foot">
        <span className="section-footer">{text.length > NOTE_MAX - 300 ? `${text.length} / ${NOTE_MAX}` : t('Сохранится при закрытии')}</span>
        {(initial || text) && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              haptic('light')
              onClose('')
            }}
          >
            {t('Удалить')}
          </button>
        )}
      </div>
      <button type="button" className="button-primary" onClick={close}>
        {t('Готово')}
      </button>
    </Sheet>
  )
}
