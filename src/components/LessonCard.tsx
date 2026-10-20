import { formatDuration } from '../format'
import { NoteIcon, PersonIcon, PinIcon } from '../icons'
import { shortWhen } from '../../shared/edits-core'
import type { DayLesson } from '../edits'
import { toMinutes } from '../schedule'

const KIND_CLASS: Record<string, string> = {
  Лекция: 'k-lecture',
  Практика: 'k-practice',
  Лабораторная: 'k-lab',
}

type Props = {
  lesson: DayLesson // пара с правками: отменена, перенесена, добавлена, подгруппа, пометки
  // минуты от полуночи, если карточка показывается за сегодня; иначе null
  nowMinutes: number | null
  isNext: boolean
  pair: number | null // номер пары по сетке группы; у добавленной правкой — нет
  note: string | undefined
  onEditNote?: () => void // нет — чужое расписание, без заметок
}

export function LessonCard({ lesson, nowMinutes, isNext, pair, note, onEditNote }: Props) {
  const start = toMinutes(lesson.start)
  const end = toMinutes(lesson.end)
  const cancelled = Boolean(lesson.cancel || lesson.movedTo)
  const live = !cancelled && nowMinutes !== null && nowMinutes >= start && nowMinutes < end
  const past = nowMinutes !== null && nowMinutes >= end
  const kindClass = (lesson.kind && KIND_CLASS[lesson.kind]) || 'k-other'

  return (
    // вся карточка открывает заметку; кнопка с карандашом — то же самое для клавиатуры и скринридеров
    <article
      className={`lesson ${kindClass}${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
      onClick={onEditNote}
      data-readonly={onEditNote ? undefined : true}
    >
      <div className="lesson-time">
        <span className="lesson-start">{lesson.start}</span>
        <span className="lesson-end">{lesson.end}</span>
      </div>
      <div className="lesson-body">
        <div className="lesson-top">
          {lesson.kind && <span className="badge">{lesson.kind}</span>}
          {pair ? <span className="lesson-pair">{pair} пара</span> : null}
          {lesson.added && <span className="badge badge-edit">добавлена</span>}
          {lesson.subgroup && <span className="badge badge-sub">{lesson.subgroup.name}</span>}
          {onEditNote && (
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
          )}
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
                <PersonIcon /> {lesson.teachers?.join(', ') ?? lesson.teacher}
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
        {lesson.cancel && (
          <div className="lesson-cancel">Пара отменена{lesson.cancel.text ? `: ${lesson.cancel.text}` : ''}</div>
        )}
        {lesson.movedTo && (
          <div className="lesson-cancel">Перенесена на {shortWhen(lesson.movedTo.date, lesson.movedTo.start)}</div>
        )}
        {lesson.movedFrom && (
          <div className="edit-note edit-note-lesson">↩️ Перенос с {shortWhen(lesson.movedFrom.date, lesson.movedFrom.start)}</div>
        )}
        {lesson.notes.map((text, i) => (
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
