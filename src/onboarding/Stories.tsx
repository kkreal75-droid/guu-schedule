// Экраны-«истории»: сегменты прогресса сверху, крупная картинка по центру, надпись, заголовок, текст;
// «Далее» / «Назад» внизу, свайп влево-вправо. Ими сделаны истории автора и тур по приложению.
import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'

export type Story = {
  visual: ReactNode // эмодзи в плитке или живой пример экрана
  overline: string
  title: string
  text?: ReactNode
  note?: string // мелко внизу экрана
}

type Props = {
  stories: Story[]
  onDone: () => void
  onBack?: () => void // «Назад» с первой истории (нет — кнопки нет)
  onSkip?: () => void // «Пропустить» справа от прогресса (тур)
  doneLabel?: string // подпись кнопки на последней истории
}

export const EmojiTile = ({ emoji }: { emoji: string }) => (
  <div className="ob-emoji" aria-hidden="true">
    {emoji}
  </div>
)

export function Stories({ stories, onDone, onBack, onSkip, doneLabel = 'Далее' }: Props) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd')
  const touch = useRef<{ x: number; y: number } | null>(null)
  const story = stories[index]
  const last = index === stories.length - 1

  const next = useCallback(() => {
    haptic()
    if (index === stories.length - 1) return onDone()
    setDirection('fwd')
    setIndex(index + 1)
  }, [index, stories.length, onDone])
  const prev = useCallback(() => {
    haptic()
    if (index === 0) return onBack?.()
    setDirection('back')
    setIndex(index - 1)
  }, [index, onBack])
  useBackButton(index > 0 || onBack ? prev : null)

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: TouchEvent) => {
    if (!touch.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    touch.current = null
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) next()
    else if (index > 0 || onBack) prev()
  }

  return (
    <div className="ob ob-stories" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="ob-top">
        <div className="ob-bar">
          <div className="ob-progress" aria-label={`${index + 1} из ${stories.length}`}>
            {stories.map((_, i) => (
              <span key={i} className="ob-seg" data-on={i <= index || undefined} />
            ))}
          </div>
          {onSkip && (
            <button type="button" className="ob-skip" onClick={() => (haptic(), onSkip())}>
              Пропустить
            </button>
          )}
        </div>
      </div>

      <div key={index} className={`ob-story ob-story-${direction}`}>
        <div className="ob-story-visual">{story.visual}</div>
        <p className="ob-overline">{story.overline}</p>
        <h1 className="ob-title">{story.title}</h1>
        {story.text && <div className="ob-text">{story.text}</div>}
      </div>

      <div className="ob-foot">
        {story.note && <p className="ob-note">{story.note}</p>}
        <button type="button" className="button-primary" onClick={next}>
          {last ? doneLabel : 'Далее'}
        </button>
        {(index > 0 || onBack) && (
          <button type="button" className="button-secondary" onClick={prev}>
            Назад
          </button>
        )}
      </div>
    </div>
  )
}
