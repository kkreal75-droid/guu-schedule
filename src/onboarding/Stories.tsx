// Экраны-«истории»: полоска прогресса сверху, по центру эмодзи или живой пример, заголовок и текст, внизу одна
// кнопка «Далее»; «Назад» — кнопкой Telegram, свайп влево-вправо. Ими сделаны истории автора и тур по приложению.
import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t } from '../i18n'

export type Story = {
  visual: ReactNode // эмодзи или живой пример экрана
  title: string
  text?: string
  note?: string // мелко под текстом
}

type Props = {
  stories: Story[]
  onDone: () => void
  onBack?: () => void // «Назад» с первой истории (нет — кнопка Telegram скрыта)
  onSkip?: () => void // «Пропустить» под полоской прогресса (тур)
  doneLabel?: string // подпись кнопки на последней истории
}

export const StoryEmoji = ({ emoji }: { emoji: string }) => (
  <p className="ob-emoji" aria-hidden="true">
    {emoji}
  </p>
)

// полоска прогресса 3 px (знакомство, регистрация, тур)
export const Progress = ({ value, label }: { value: number; label?: string }) => (
  <div className="ob-progress" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <span style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
  </div>
)

export function Stories({ stories, onDone, onBack, onSkip, doneLabel = t('Далее') }: Props) {
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
    <div className="ob" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Progress value={(index + 1) / stories.length} label={t('{n} из {total}', { n: index + 1, total: stories.length })} />
      {onSkip && (
        <div className="ob-skip-row">
          <button type="button" className="link-btn link-btn-gray" onClick={() => (haptic(), onSkip())}>
            {t('Пропустить')}
          </button>
        </div>
      )}

      <div key={index} className={`ob-center ob-story${direction === 'back' ? ' ob-story-back' : ''}`}>
        {story.visual}
        <h1 className="ob-title">{story.title}</h1>
        {story.text && <p className="ob-text">{story.text}</p>}
        {story.note && <p className="ob-note">{story.note}</p>}
      </div>

      <div className="bottom-action">
        <button type="button" className="button-primary" onClick={next}>
          {last ? doneLabel : t('Далее')}
        </button>
      </div>
    </div>
  )
}
