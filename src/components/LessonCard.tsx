import { formatDuration } from '../format'
import { NoteIcon, PersonIcon, PinIcon } from '../icons'
import type { LessonEdit } from '../edits'
import { pairNumber, toMinutes, type Lesson } from '../schedule'

const KIND_CLASS: Record<string, string> = {
  Лекция: 'k-lecture',
  Практика: 'k-practice',
  Лабораторная: 'k-lab',
}

type Props = {
  lesson: Lesson
  // минуты от полуночи, если карточка показывается за сегодня; иначе null
  nowMinutes: number | null
  isNext: boolean
  // правка из админ-панели: пара отменена и/или пометка
  edit?: LessonEdit
  note: string | undefined
  onEditNote: () => void
}

export function LessonCard({ lesson, nowMinutes, isNext, edit, note, onEditNote }: Props) {
  const start = toMinutes(lesson.start)
  const end = toMinutes(lesson.end)
  const cancelled = Boolean(edit?.cancel)
  const live = !cancelled && nowMinutes !== null && nowMinutes >= start && nowMinutes < end
  const past = nowMinutes !== null && nowMinutes >= end
  const kindClass = (lesson.kind && KIND_CLASS[lesson.kind]) || 'k-other'

  return (
    // вся карточка открывает заметку; кнопка с карандашом — то же самое для клавиатуры и скринридеров
    <article
      className={`lesson ${kindClass}${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
      onClick={onEditNote}
    >
      <div className="lesson-time">
        <span className="lesson-start">{lesson.start}</span>
        <span className="lesson-end">{lesson.end}</span>
      </div>
      <div className="lesson-body">
        <div className="lesson-top">
          {lesson.kind && <span className="badge">{lesson.kind}</span>}
          <span className="lesson-pair">{pairNumber(lesson.start)} пара</span>
          <button
            type="button"
            className="lesson-note-btn"
            data-has-note={note ? true : undefined}
            aria-label={note ? 'Изменить заметку к паре' : 'Добавить заметку к паре'}
            onClick={(e) => {
              e.stopPropagation()
              onEditNote()
            }}
          >
            <NoteIcon />
          </button>
        </div>
        <h3 className="lesson-subject">{lesson.subject}</h3>
        {(lesson.room || lesson.teacher) && (
          <div className="lesson-meta">
            {lesson.room && (
              <span>
                <PinIcon /> {lesson.room}
              </span>
            )}
            {lesson.teacher && (
              <span>
                <PersonIcon /> {lesson.teacher}
              </span>
            )}
          </div>
        )}
        {live && (
          <div className="lesson-status">
            <span>Идёт сейчас · ещё {formatDuration(end - nowMinutes!)}</span>
            <div className="progress">
              <div style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
            </div>
          </div>
        )}
        {edit?.cancel && (
          <div className="lesson-cancel">Пара отменена{edit.cancel.text ? `: ${edit.cancel.text}` : ''}</div>
        )}
        {edit?.notes.map((text, i) => (
          <div key={i} className="edit-note edit-note-lesson">
            📌 {text}
          </div>
        ))}
        {isNext && !live && (
          <div className="lesson-status is-soon">Начнётся через {formatDuration(start - nowMinutes!)}</div>
        )}
        {note && <p className="note-text lesson-note">{note}</p>}
      </div>
    </article>
  )
}
