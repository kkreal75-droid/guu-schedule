import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DayLesson } from '../edits'
import type { HideScope } from '../hidden'
import type { Progress } from '../../shared/progress-core'
import { formatDayShort, weeksText } from '../format'
import { KIND_CLASS } from './LessonCard'
import { ChevronLeft, ChevronRight, EyeOffIcon, NoteIcon } from '../icons'
import { haptic, supports, tg } from '../telegram'
import { t, tn } from '../i18n'
import { trKind, trSubject } from '../guu'

// Шторка пары: нажатие на карточку, «⋯» или долгое нажатие. Сверху — ход предмета (этап 12): «Занятие 4 из 6 ·
// осталось 2 · последнее 20.11 (12-я неделя)» и недели. Действия: заметка, «Это не моя пара» → скрыть в этот день,
// по чётным, по нечётным или всегда (только у себя: приложение, календарь, inline). У пары языкового блока потока
// (lesson.stream) — объяснение, почему у неё несколько окон. В чужом расписании — только детали.

type Props = {
  lesson: DayLesson
  subtitle: string // «Среда, 21 октября · 9:00–10:30»
  week: number // неделя этого дня — чтобы подписать «эта неделя»
  start: 'menu' | 'hide' // с чего открыть: со списка действий или сразу «Это не моя пара»
  progress?: (Progress & { index: number }) | null // ход предмета; нет — без него (предмет на весь семестр)
  actions?: boolean // false — только детали (чужое расписание)
  onNote?: () => void // нет — без заметок (чужое расписание)
  onHide?: (scope: HideScope) => void // нет — скрывать нельзя (вне Telegram)
  onClose: () => void
}

export function LessonMenu({ lesson, subtitle, week, start, progress, actions = true, onNote, onHide, onClose }: Props) {
  const [step, setStep] = useState(start)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // «Назад» в шапке Telegram и Escape — закрыть
  useEffect(() => {
    if (!supports('6.1')) return
    tg!.BackButton.show()
    return () => {
      tg!.BackButton.hide()
    }
  }, [])
  useEffect(() => {
    if (supports('6.1')) tg!.BackButton.onClick(onClose)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      if (supports('6.1')) tg!.BackButton.offClick(onClose)
      window.removeEventListener('keydown', onKey)
    }
  })

  // чётные / нечётные — только если пара бывает и по тем, и по другим неделям
  const both = lesson.weeks.some((w) => w % 2 === 0) && lesson.weeks.some((w) => w % 2 === 1)
  const here = week % 2 === 0 ? 'even' : 'odd'
  const options: { scope: HideScope; title: string; sub?: string }[] = [
    { scope: 'day', title: t('Скрыть только в этот день') },
    ...(both
      ? [
          { scope: 'even' as const, title: t('Скрыть по чётным'), sub: here === 'even' ? t('эта неделя') : undefined },
          { scope: 'odd' as const, title: t('Скрыть по нечётным'), sub: here === 'odd' ? t('эта неделя') : undefined },
        ]
      : []),
    { scope: 'always', title: t('Скрыть всегда') },
  ]

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet lesson-menu" role="dialog" aria-modal="true" aria-label={trSubject(lesson.subject)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="sheet-heading">
            <div className="sheet-title">{trSubject(lesson.subject)}</div>
            <div className="sheet-sub">{subtitle}</div>
          </div>
          <button type="button" className="sheet-done" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>

        <div className={`lesson-details ${(lesson.kind && KIND_CLASS[lesson.kind]) || 'k-other'}`}>
          {lesson.kind && <span className="badge">{trKind(lesson.kind)}</span>}
          {lesson.weeks.length > 0 && !lesson.added && !lesson.movedFrom && (
            <span className="lesson-details-weeks">{t('Недели: {weeks}', { weeks: weeksText(lesson.weeks) })}</span>
          )}
        </div>
        {progress && (
          <div className="course-progress" data-finished={progress.finished || undefined}>
            <div className="course-progress-line">
              {progress.index > 0 ? (
                <b>{t('Занятие {n} из {total}', { n: progress.index, total: progress.total })}</b>
              ) : (
                <b>{t('Занятий в семестре: {total}', { total: progress.total })}</b>
              )}
              <span>
                {progress.finished
                  ? t('закончилось {date}', { date: formatDayShort(progress.last.day) })
                  : t('осталось {n}', { n: progress.left })}
              </span>
            </div>
            <div className="progress course-progress-bar" aria-hidden="true">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="course-progress-sub">
              {t('последнее {date} ({week})', {
                date: formatDayShort(progress.last.day),
                week: t('{n}-я неделя', { n: progress.last.week }),
              })}
              {' · '}
              {progress.hours} {tn(progress.hours, 'ак. час|ак. часа|ак. часов')}
            </div>
          </div>
        )}

        {lesson.stream && actions && (
          <p className="lesson-menu-text">
            {t('Языковая пара потока: в расписании ГУУ она стоит у всего потока сразу в нескольких окнах, а ты ходишь в одно — по своей подгруппе. Лишние окна скрой — они пропадут и из календаря на телефоне.')}
          </p>
        )}

        {!actions ? null : step === 'menu' ? (
          <div className="lesson-menu-list">
            {onNote && (
              <button type="button" className="row row-btn" onClick={() => (haptic(), onNote())}>
                <span className="lesson-menu-label">
                  <NoteIcon /> {t('Заметка к паре')}
                </span>
              </button>
            )}
            <button type="button" className="row row-btn" onClick={() => (haptic(), setStep('hide'))}>
              <span className="lesson-menu-label">
                <EyeOffIcon /> {t('Это не моя пара')}
              </span>
              <ChevronRight className="row-chevron" />
            </button>
          </div>
        ) : (
          <>
            {start === 'menu' && (
              <button type="button" className="lesson-menu-back" onClick={() => (haptic(), setStep('menu'))}>
                <ChevronLeft /> {t('Это не моя пара')}
              </button>
            )}
            {onHide ? (
              <div className="lesson-menu-list">
                {options.map((o) => (
                  <button key={o.scope} type="button" className="row row-btn" onClick={() => (haptic('light'), onHide(o.scope))}>
                    <span>{o.title}</span>
                    {o.sub && <span className="row-value">{o.sub}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="lesson-menu-text">{t('Скрывать пары можно в приложении внутри Telegram.')}</p>
            )}
            <p className="sheet-hint lesson-menu-hint">
              {t('Скрытое видишь только ты. Вернуть — «Профиль → Скрытые пары».')}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
