import { useRef } from 'react'
import { formatDuration, weeksText } from '../format'
import { ClockIcon, DotsIcon, NoteIcon, PeopleIcon, PersonIcon, PinIcon } from '../icons'
import { shortWhen } from '../../shared/edits-core'
import type { ShownLesson } from '../lessons'
import { toMinutes } from '../schedule'
import { haptic } from '../telegram'
import { t } from '../i18n'
import { roomLabel, trKind, trSubject, trTeacher } from '../guu'

export const KIND_CLASS: Record<string, string> = {
  Лекция: 'k-lecture',
  Практика: 'k-practice',
  Лабораторная: 'k-lab',
}

// «09:00» → «9:00»: крупное время начала читается быстрее без ведущего нуля
const short = (time: string) => time.replace(/^0(\d)/, '$1')

type Props = {
  lesson: ShownLesson // пара с правками: отменена, перенесена, добавлена, подгруппа, пометки; у преподавателя — группы
  // минуты от полуночи, если карточка показывается за сегодня; иначе null
  nowMinutes: number | null
  isNext: boolean
  pair: number | null // номер пары по сетке группы; у добавленной правкой — нет
  note: string | undefined
  last?: boolean // последнее занятие предмета в семестре (этап 12)
  showWeeks?: boolean // показать недели пары (расписание преподавателя)
  onEditNote?: () => void // нет — чужое расписание, без заметок
  onOpen?: () => void // нажатие на карточку — шторка с деталями (ход предмета)
  onGroup?: (group: string) => void // нажатие на группу у пары преподавателя — её расписание
  groupTitle?: (id: string, name: string) => string // полное название группы — подсказкой
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

export function LessonCard({
  lesson, nowMinutes, isNext, pair, note, last, showWeeks, onEditNote, onOpen, onGroup, groupTitle, onTeacher, onRoom, onMenu,
}: Props) {
  const press = useLongPress(onMenu && (() => onMenu('menu')))
  const start = toMinutes(lesson.start)
  const end = toMinutes(lesson.end)
  const cancelled = Boolean(lesson.cancel || lesson.movedTo)
  const live = !cancelled && nowMinutes !== null && nowMinutes >= start && nowMinutes < end
  const past = nowMinutes !== null && nowMinutes >= end
  const kindClass = (lesson.kind && KIND_CLASS[lesson.kind]) || 'k-other'
  // у преподавателя вместо преподавателя — группы (чипами)
  const audience = lesson.audience
  const teachers = audience ? [] : (lesson.teachers ?? (lesson.teacher ? [lesson.teacher] : []))
  // английская версия: предмет — перевод (оригинал мелко под ним), аудитория — код и корпус по-английски
  const subject = trSubject(lesson.subject)
  const room = lesson.room ? roomLabel(lesson.room) : null
  // код аудитории — данные ГУУ (lang="ru"), корпус — на языке интерфейса
  const roomText = room && (
    <>
      {room.code && <span lang="ru">{room.code}</span>}
      {room.code && room.building && ' · '}
      {room.building}
    </>
  )

  return (
    <article
      className={`lesson ${kindClass}${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
      data-readonly={onEditNote ? undefined : true}
      data-clickable={onOpen ? true : undefined}
      {...press}
      onClick={(e) => {
        // кнопки и ссылки внутри карточки — свои действия
        if (!onOpen || (e.target as HTMLElement).closest('button, a')) return
        onOpen()
      }}
    >
      <div className="lesson-head">
        <span className="lesson-start">{short(lesson.start)}</span>
        <span className="lesson-end">— {short(lesson.end)}</span>
        {pair ? <span className="lesson-pair">{t('{n} пара', { n: pair })}</span> : null}
        {onEditNote && (
          <button
            type="button"
            className="lesson-note-btn"
            data-has-note={note ? true : undefined}
            aria-label={note ? t('Изменить заметку к паре') : t('Добавить заметку к паре')}
            onClick={onEditNote}
          >
            <NoteIcon />
          </button>
        )}
        {onMenu && (
          <button
            type="button"
            className="lesson-note-btn lesson-more-btn"
            aria-label={t('Действия с парой')}
            onClick={() => onMenu('menu')}
          >
            <DotsIcon />
          </button>
        )}
      </div>

      {(lesson.kind || lesson.added || lesson.subgroup || last || lesson.overlap) && (
        <div className="lesson-tags">
          {lesson.kind && <span className="badge">{trKind(lesson.kind)}</span>}
          {lesson.added && <span className="badge badge-edit">{t('добавлена')}</span>}
          {lesson.subgroup && <span className="badge badge-sub">{lesson.subgroup.name}</span>}
          {last && !lesson.cancel && !lesson.movedTo && <span className="badge badge-last">{t('последнее занятие')}</span>}
          {lesson.overlap && <span className="badge badge-warn">{t('накладка в расписании')}</span>}
        </div>
      )}
      <h3 className="lesson-subject">{subject}</h3>
      {/* по-английски — под переводом мелко оригинал, как в расписании ГУУ */}
      {subject !== lesson.subject && (
        <div className="lesson-subject-ru" lang="ru">
          {lesson.subject}
        </div>
      )}

      {(teachers.length > 0 || lesson.room) && (
        <div className="lesson-meta">
          {teachers.map((name) =>
            onTeacher ? (
              <button key={name} type="button" className="lesson-link" onClick={() => onTeacher(name)}>
                <PersonIcon /> {trTeacher(name)}
              </button>
            ) : (
              <span key={name}>
                <PersonIcon /> {trTeacher(name)}
              </span>
            ),
          )}
          {lesson.room &&
            (onRoom ? (
              <button type="button" className="lesson-link" onClick={() => onRoom(lesson.room!)}>
                <PinIcon /> {roomText}
              </button>
            ) : (
              <span>
                <PinIcon /> {roomText}
              </span>
            ))}
        </div>
      )}

      {showWeeks && lesson.weeks.length > 0 && (
        <div className="lesson-weeks">{t('Недели: {weeks}', { weeks: weeksText(lesson.weeks) })}</div>
      )}

      {audience && audience.length > 0 && (
        <div className="lesson-groups">
          {audience.map((g) => {
            const title = groupTitle?.(g.id, g.name) ?? g.name
            return onGroup ? (
              <button key={g.id} type="button" className="group-pill" title={title} aria-label={title} onClick={() => (haptic(), onGroup(g.id))}>
                <PeopleIcon /> <span lang="ru">{g.name}</span>
              </button>
            ) : (
              <span key={g.id} className="group-pill" title={title}>
                <PeopleIcon /> <span lang="ru">{g.name}</span>
              </span>
            )
          })}
        </div>
      )}

      {lesson.stream &&
        (onMenu ? (
          <button type="button" className="lesson-hint" onClick={() => onMenu('hide')}>
            {t('Языковая пара потока — у тебя может быть другое время')}
          </button>
        ) : (
          <div className="lesson-hint">{t('Языковая пара потока — у тебя может быть другое время')}</div>
        ))}

      {live && (
        <div className="lesson-live">
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
          </div>
          <span className="lesson-timer" aria-label={t('До конца пары {d}', { d: formatDuration(end - nowMinutes!) })}>
            <ClockIcon /> {formatDuration(end - nowMinutes!)}
          </span>
        </div>
      )}
      {isNext && !live && <div className="lesson-soon">{t('через {d}', { d: formatDuration(start - nowMinutes!) })}</div>}
      {lesson.cancel && (
        <div className="lesson-cancel">
          {t('Пара отменена')}
          {lesson.cancel.text ? `: ${lesson.cancel.text}` : ''}
        </div>
      )}
      {lesson.movedTo && <div className="lesson-cancel">{t('Перенесена на {when}', { when: shortWhen(lesson.movedTo.date, lesson.movedTo.start) })}</div>}
      {lesson.movedFrom && (
        <div className="edit-note edit-note-lesson">{t('↩️ Перенос с {when}', { when: shortWhen(lesson.movedFrom.date, lesson.movedFrom.start) })}</div>
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
