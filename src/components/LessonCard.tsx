import { useRef } from 'react'
import { formatDuration } from '../format'
import { ClockIcon, DotsIcon, NoteIcon, PersonIcon, PinIcon } from '../icons'
import { shortWhen } from '../../shared/edits-core'
import type { DayLesson } from '../edits'
import { toMinutes } from '../schedule'

const KIND_CLASS: Record<string, string> = {
  Лекция: 'k-lecture',
  Практика: 'k-practice',
  Лабораторная: 'k-lab',
}

// «09:00» → «9:00»: крупное время начала читается быстрее без ведущего нуля
const short = (time: string) => time.replace(/^0(\d)/, '$1')

type Props = {
  lesson: DayLesson // пара с правками: отменена, перенесена, добавлена, подгруппа, пометки
  // минуты от полуночи, если карточка показывается за сегодня; иначе null
  nowMinutes: number | null
  isNext: boolean
  pair: number | null // номер пары по сетке группы; у добавленной правкой — нет
  note: string | undefined
  onEditNote?: () => void // нет — чужое расписание, без заметок
  onTeacher?: (name: string) => void // нажатие на преподавателя — его карточка
  onRoom?: (room: string) => void // нажатие на аудиторию — корпус
  // «⋯» и долгое нажатие — действия с парой (заметка, «Это не моя пара»); hide — сразу «Это не моя пара»
  onMenu?: (start: 'menu' | 'hide') => void
}

const LONG_PRESS_MS = 500

// Долгое нажатие на карточку (палец не сдвинулся) и правый клик / системное долгое нажатие (contextmenu)
function useLongPress(onLong: (() => void) | undefined) {
  const timer = useRef(0)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(0)
  const fire = () => {
    if (!onLong || Date.now() - fired.current < 1000) return
    fired.current = Date.now()
    onLong()
  }
  const cancel = () => {
    window.clearTimeout(timer.current)
    origin.current = null
  }
  if (!onLong) return {}
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      origin.current = { x: e.clientX, y: e.clientY }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      cancel()
      fire()
    },
  }
}

export function LessonCard({ lesson, nowMinutes, isNext, pair, note, onEditNote, onTeacher, onRoom, onMenu }: Props) {
  const press = useLongPress(onMenu && (() => onMenu('menu')))
  const start = toMinutes(lesson.start)
  const end = toMinutes(lesson.end)
  const cancelled = Boolean(lesson.cancel || lesson.movedTo)
  const live = !cancelled && nowMinutes !== null && nowMinutes >= start && nowMinutes < end
  const past = nowMinutes !== null && nowMinutes >= end
  const kindClass = (lesson.kind && KIND_CLASS[lesson.kind]) || 'k-other'
  const teachers = lesson.teachers ?? (lesson.teacher ? [lesson.teacher] : [])

  return (
    <article
      className={`lesson ${kindClass}${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
      data-readonly={onEditNote ? undefined : true}
      {...press}
    >
      <div className="lesson-head">
        <span className="lesson-start">{short(lesson.start)}</span>
        <span className="lesson-end">— {short(lesson.end)}</span>
        {pair ? <span className="lesson-pair">{pair} пара</span> : null}
        {onEditNote && (
          <button
            type="button"
            className="lesson-note-btn"
            data-has-note={note ? true : undefined}
            aria-label={note ? 'Изменить заметку к паре' : 'Добавить заметку к паре'}
            onClick={onEditNote}
          >
            <NoteIcon />
          </button>
        )}
        {onMenu && (
          <button
            type="button"
            className="lesson-note-btn lesson-more-btn"
            aria-label="Действия с парой"
            onClick={() => onMenu('menu')}
          >
            <DotsIcon />
          </button>
        )}
      </div>

      {(lesson.kind || lesson.added || lesson.subgroup) && (
        <div className="lesson-tags">
          {lesson.kind && <span className="badge">{lesson.kind}</span>}
          {lesson.added && <span className="badge badge-edit">добавлена</span>}
          {lesson.subgroup && <span className="badge badge-sub">{lesson.subgroup.name}</span>}
        </div>
      )}
      <h3 className="lesson-subject">{lesson.subject}</h3>

      {(teachers.length > 0 || lesson.room) && (
        <div className="lesson-meta">
          {teachers.map((name) =>
            onTeacher ? (
              <button key={name} type="button" className="lesson-link" onClick={() => onTeacher(name)}>
                <PersonIcon /> {name}
              </button>
            ) : (
              <span key={name}>
                <PersonIcon /> {name}
              </span>
            ),
          )}
          {lesson.room &&
            (onRoom ? (
              <button type="button" className="lesson-link" onClick={() => onRoom(lesson.room!)}>
                <PinIcon /> {lesson.room}
              </button>
            ) : (
              <span>
                <PinIcon /> {lesson.room}
              </span>
            ))}
        </div>
      )}

      {lesson.stream &&
        (onMenu ? (
          <button type="button" className="lesson-hint" onClick={() => onMenu('hide')}>
            Языковая пара потока — у тебя может быть другое время
          </button>
        ) : (
          <div className="lesson-hint">Языковая пара потока — у тебя может быть другое время</div>
        ))}

      {live && (
        <div className="lesson-live">
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
          </div>
          <span className="lesson-timer" aria-label={`До конца пары ${formatDuration(end - nowMinutes!)}`}>
            <ClockIcon /> {formatDuration(end - nowMinutes!)}
          </span>
        </div>
      )}
      {isNext && !live && <div className="lesson-soon">через {formatDuration(start - nowMinutes!)}</div>}
      {lesson.cancel && (
        <div className="lesson-cancel">Пара отменена{lesson.cancel.text ? `: ${lesson.cancel.text}` : ''}</div>
      )}
      {lesson.movedTo && <div className="lesson-cancel">Перенесена на {shortWhen(lesson.movedTo.date, lesson.movedTo.start)}</div>}
      {lesson.movedFrom && (
        <div className="edit-note edit-note-lesson">↩️ Перенос с {shortWhen(lesson.movedFrom.date, lesson.movedFrom.start)}</div>
      )}
      {lesson.notes.map((text, i) => (
        <div key={i} className="edit-note edit-note-lesson">
          📌 {text}
        </div>
      ))}
      {note && (
        <button type="button" className="note-text lesson-note" onClick={onEditNote}>
          {note}
        </button>
      )}
    </article>
  )
}
