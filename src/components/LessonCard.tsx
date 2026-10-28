import { Fragment, useRef, type ReactNode } from 'react'
import { formatDuration, shortTime, weeksText } from '../format'
import { shortWhen } from '../../shared/edits-core'
import type { ShownLesson } from '../lessons'
import { toMinutes } from '../schedule'
import { haptic } from '../telegram'
import { Icon, MoreIcon } from '../icons'
import { t } from '../i18n'
import { roomLabel, trKind, trSubject, trTeacher } from '../guu'

// «Предпринимательство 4-1, 4-2»: у соседних групп с одинаковым началом названия повторяется только номер
const prefixOf = (name: string) => name.slice(0, name.lastIndexOf(' ') + 1)
const shortNames = (names: string[]) =>
  names.map((name, i) => {
    const prefix = prefixOf(name)
    return i > 0 && prefix && prefix === prefixOf(names[i - 1]) ? name.slice(prefix.length) : name
  })

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
  // «···» и долгое нажатие — действия с парой (заметка, «Это не моя пара»); hide — сразу «Это не моя пара»
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

// Карточка пары — все одного размера: время начала, «– 10:30», номер пары (у идущей — «ещё 34 мин», у следующей —
// «через 1 ч 19 мин»), справа карандаш (заметка) и ··· (действия); предмет не длиннее двух строк; внизу одной строкой
// «Практика · Яценко О.Ю. · У-448/516» (у преподавателя вместо фамилии — группы). Идёт сейчас — рамка цвета акцента,
// светлый фон, полоска по низу и мягкое свечение; прошедшие — бледнее.
export function LessonCard({
  lesson, nowMinutes, isNext, pair, note, last, showWeeks, onEditNote, onOpen, onGroup, groupTitle, onTeacher, onRoom, onMenu,
}: Props) {
  const press = useLongPress(onMenu && (() => onMenu('menu')))
  const start = toMinutes(lesson.start)
  const end = toMinutes(lesson.end)
  const cancelled = Boolean(lesson.cancel || lesson.movedTo)
  const live = !cancelled && nowMinutes !== null && nowMinutes >= start && nowMinutes < end
  const past = nowMinutes !== null && nowMinutes >= end
  // у преподавателя вместо преподавателя — группы
  const audience = lesson.audience
  const teachers = audience ? [] : (lesson.teachers ?? (lesson.teacher ? [lesson.teacher] : []))
  const groupLabels = audience ? shortNames(audience.map((g) => g.name)) : []
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

  // «Практика · Яценко О.Ю. · У-448/516»: вид — светло-серым, преподаватель (группы) и аудитория — серым, нажимаются
  const meta: ReactNode[] = []
  if (lesson.kind) meta.push(<span className="lesson-kind">{trKind(lesson.kind)}</span>)
  if (teachers.length)
    meta.push(
      teachers.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && ', '}
          {onTeacher ? (
            <button type="button" className="lesson-link" onClick={() => onTeacher(name)}>
              {trTeacher(name)}
            </button>
          ) : (
            trTeacher(name)
          )}
        </Fragment>
      )),
    )
  if (audience && audience.length)
    meta.push(
      audience.map((g, i) => {
        const title = groupTitle?.(g.id, g.name) ?? g.name
        return (
          <Fragment key={g.id}>
            {i > 0 && ', '}
            {onGroup ? (
              <button type="button" className="lesson-link" title={title} aria-label={title} onClick={() => (haptic(), onGroup(g.id))}>
                <span lang="ru">{groupLabels[i]}</span>
              </button>
            ) : (
              <span lang="ru" title={title}>
                {groupLabels[i]}
              </span>
            )}
          </Fragment>
        )
      }),
    )
  if (roomText)
    meta.push(
      onRoom ? (
        <button type="button" className="lesson-link lesson-room" onClick={() => onRoom(lesson.room!)}>
          {roomText}
        </button>
      ) : (
        <span className="lesson-room">{roomText}</span>
      ),
    )

  const tags = [
    lesson.added && t('добавлена'),
    lesson.subgroup?.name,
    last && !cancelled && t('последнее занятие'),
    lesson.overlap && t('накладка в расписании'),
  ].filter((x): x is string => Boolean(x))

  return (
    <article
      className={`lesson${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
      data-clickable={onOpen ? true : undefined}
      {...press}
      onClick={(e) => {
        // кнопки и ссылки внутри карточки — свои действия
        if (!onOpen || (e.target as HTMLElement).closest('button, a')) return
        onOpen()
      }}
    >
      <div className="lesson-head">
        <span className="lesson-start">{shortTime(lesson.start)}</span>
        <span className="lesson-end">– {shortTime(lesson.end)}</span>
        {live ? (
          <span className="lesson-status lesson-status-live" aria-label={t('До конца пары {d}', { d: formatDuration(end - nowMinutes!) })}>
            {t('ещё {d}', { d: formatDuration(end - nowMinutes!) })}
          </span>
        ) : isNext ? (
          <span className="lesson-status">{t('через {d}', { d: formatDuration(start - nowMinutes!) })}</span>
        ) : pair ? (
          <span className="lesson-pair">{t('{n} пара', { n: pair })}</span>
        ) : null}
        {(onEditNote || onMenu) && (
          <span className="lesson-actions">
            {onEditNote && (
              <button
                type="button"
                className="lesson-act"
                aria-label={note ? t('Изменить заметку к паре') : t('Добавить заметку к паре')}
                onClick={onEditNote}
              >
                <Icon name="pencil" size={17} />
              </button>
            )}
            {onMenu && (
              <button type="button" className="lesson-act" aria-label={t('Действия с парой')} onClick={() => onMenu('menu')}>
                <MoreIcon />
              </button>
            )}
          </span>
        )}
      </div>

      <h3 className="lesson-subject">{subject}</h3>
      {/* по-английски — под переводом мелко оригинал, как в расписании ГУУ */}
      {subject !== lesson.subject && (
        <div className="lesson-subject-ru" lang="ru">
          {lesson.subject}
        </div>
      )}

      {meta.length > 0 && (
        <p className="lesson-meta">
          {meta.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="lesson-sep"> · </span>}
              {part}
            </Fragment>
          ))}
        </p>
      )}

      {tags.length > 0 && (
        <div className="lesson-tags">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {showWeeks && lesson.weeks.length > 0 && <div className="lesson-line">{t('Недели: {weeks}', { weeks: weeksText(lesson.weeks) })}</div>}

      {lesson.stream &&
        (onMenu ? (
          <button type="button" className="lesson-line lesson-hint" onClick={() => onMenu('hide')}>
            {t('Языковая пара потока — у тебя может быть другое время')}
          </button>
        ) : (
          <div className="lesson-line">{t('Языковая пара потока — у тебя может быть другое время')}</div>
        ))}

      {lesson.cancel && (
        <div className="lesson-cancel">
          {t('Пара отменена')}
          {lesson.cancel.text ? `: ${lesson.cancel.text}` : ''}
        </div>
      )}
      {lesson.movedTo && <div className="lesson-cancel">{t('Перенесена на {when}', { when: shortWhen(lesson.movedTo.date, lesson.movedTo.start) })}</div>}
      {lesson.movedFrom && <div className="lesson-line">{t('Перенос с {when}', { when: shortWhen(lesson.movedFrom.date, lesson.movedFrom.start) })}</div>}
      {lesson.notes.map((text, i) => (
        <div key={i} className="lesson-line">
          <Icon name="pin" size={16} />
          <span>{text}</span>
        </div>
      ))}
      {note && (
        <button type="button" className="lesson-line lesson-note" onClick={onEditNote}>
          <Icon name="note" size={16} />
          <span>{note}</span>
        </button>
      )}

      {live && (
        <div className="progress lesson-bar" aria-hidden="true">
          <span style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
        </div>
      )}
    </article>
  )
}
