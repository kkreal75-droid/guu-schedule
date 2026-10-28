import { useState } from 'react'
import type { DayLesson } from '../edits'
import type { HideScope } from '../hidden'
import type { Progress } from '../../shared/progress-core'
import { formatDate, formatDayShort, weeksText } from '../format'
import { Row } from './Row'
import { Sheet } from './Sheet'
import { ChevronLeft } from '../icons'
import { haptic } from '../telegram'
import { t, tn } from '../i18n'
import { trKind, trSubject } from '../guu'

// Меню пары — окно снизу: нажатие на карточку, «···» или долгое нажатие. Сверху ход предмета (этап 12):
// «Занятие 4 из 8 · осталось 5», красная полоска, недели, последнее занятие и часы. Действия: заметка, «Это не моя
// пара» → скрыть в этот день, по чётным, по нечётным или всегда (только у себя: приложение, календарь, inline).
// У пары языкового блока потока (lesson.stream) — объяснение, почему у неё несколько окон. В чужом расписании —
// только детали.

type Props = {
  lesson: DayLesson
  subtitle: string // «Среда, 21 октября, 9:00–10:30»
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
  const weeks = lesson.weeks.length > 0 && !lesson.added && !lesson.movedFrom ? t('Недели: {weeks}', { weeks: weeksText(lesson.weeks) }) : null

  return (
    <Sheet label={trSubject(lesson.subject)} onClose={onClose} className="lesson-menu">
      <h2 className="sheet-title">{trSubject(lesson.subject)}</h2>
      <p className="sheet-sub">
        {subtitle}
        {lesson.kind ? ` · ${trKind(lesson.kind)}` : ''}
      </p>

      {progress ? (
        <div className="course-progress" data-finished={progress.finished || undefined}>
          <div className="course-progress-line">
            <span>
              {progress.index > 0
                ? t('Занятие {n} из {total}', { n: progress.index, total: progress.total })
                : t('Занятий в семестре: {total}', { total: progress.total })}
            </span>
            <span className="course-progress-left">
              {progress.finished ? t('закончилось {date}', { date: formatDayShort(progress.last.day) }) : t('осталось {n}', { n: progress.left })}
            </span>
          </div>
          <div className="progress course-progress-bar" aria-hidden="true">
            <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="course-progress-sub">
            {weeks && `${weeks}. `}
            {t('Последнее {date}', { date: formatDate(progress.last.day) })}, {progress.hours} {tn(progress.hours, 'ак. час|ак. часа|ак. часов')}
          </p>
        </div>
      ) : (
        weeks && (
          <div className="course-progress">
            <p className="course-progress-sub">{weeks}</p>
          </div>
        )
      )}

      {lesson.stream && actions && (
        <p className="lesson-menu-text">
          {t('Языковая пара потока: в расписании ГУУ она стоит у всего потока сразу в нескольких окнах, а ты ходишь в одно — по своей подгруппе. Лишние окна скрой — они пропадут и из календаря на телефоне.')}
        </p>
      )}

      {!actions ? null : step === 'menu' ? (
        <div className="list">
          {onNote && <Row emoji="📝" title={t('Заметка к паре')} chevron onClick={() => (haptic(), onNote())} />}
          <Row emoji="🙈" title={t('Это не моя пара')} sub={t('Скрыть, если это не твой поток')} chevron onClick={() => (haptic(), setStep('hide'))} />
        </div>
      ) : (
        <>
          {start === 'menu' && (
            <button type="button" className="link-btn lesson-menu-back" onClick={() => (haptic(), setStep('menu'))}>
              <ChevronLeft /> {t('Это не моя пара')}
            </button>
          )}
          {onHide ? (
            <div className="list">
              {options.map((o) => (
                <Row key={o.scope} title={o.title} value={o.sub} onClick={() => (haptic('light'), onHide(o.scope))} />
              ))}
            </div>
          ) : (
            <p className="lesson-menu-text">{t('Скрывать пары можно в приложении внутри Telegram.')}</p>
          )}
          <p className="section-footer">{t('Скрытое видишь только ты. Вернуть — «Профиль → Скрытые пары».')}</p>
        </>
      )}
    </Sheet>
  )
}
