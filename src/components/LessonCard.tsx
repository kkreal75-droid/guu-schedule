import { Fragment, useRef } from 'react'
import { formatDuration, shortTime, weeksText } from '../format'
import { shortWhen } from '../../shared/edits-core'
import type { ShownLesson } from '../lessons'
import { toMinutes } from '../schedule'
import { haptic } from '../telegram'
import { Icon, MoreIcon } from '../icons'
import { t } from '../i18n'
import { roomLabel, trKind, trSubject, trTeacher } from '../guu'

// вид занятия — цвет метки и полоски слева: лекция — синий, практика и семинары — зелёный, лабораторная —
// фиолетовый, остальное — янтарный
const KIND_TONE: Record<string, string> = { Лекция: 'lecture', Практика: 'practice', Семинар: 'practice', Лабораторная: 'lab' } // i18n-ignore — виды из файлов ГУУ
const kindTone = (kind: string) => KIND_TONE[kind] ?? 'other'

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

// Карточка пары: полоска слева цвета вида пары, время начала крупно, «— 10:30», номер пары, справа карандаш
// (заметка) и ··· (действия); метка вида, предмет не длиннее двух строк; каждый преподаватель со значком (у
// преподавателя — группы), под ними аудитория со значком — нажимаются. Карточки с мягким свечением.
// Идёт сейчас — рамка цвета акцента, светлый фон, пульсирующее свечение, под чертой полоска и «⏱ 34 мин»; следующая —
// «через 1 ч 19 мин»; прошедшие — бледнее.
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

  // каждый преподаватель со значком (у преподавателя — группы), аудитория со значком; нажимаются
  const who = teachers.map((name) => (
    <span key={name} className="lesson-who-item">
      <Icon name="person" size={16} strokeWidth={2} />
      {onTeacher ? (
        <button type="button" className="lesson-link" onClick={() => onTeacher(name)}>
          {trTeacher(name)}
        </button>
      ) : (
        <span>{trTeacher(name)}</span>
      )}
    </span>
  ))
  const groups =
    audience && audience.length
      ? audience.map((g, i) => {
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
        })
      : null

  const tags = [
    lesson.added && t('добавлена'),
    lesson.subgroup?.name,
    last && !cancelled && t('последнее занятие'),
    lesson.overlap && t('накладка в расписании'),
  ].filter((x): x is string => Boolean(x))

  return (
    <article
      className={`lesson lesson-${lesson.kind ? kindTone(lesson.kind) : 'other'}${live ? ' is-live' : ''}${past ? ' is-past' : ''}${cancelled ? ' is-cancelled' : ''}`}
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
        <span className="lesson-end">— {shortTime(lesson.end)}</span>
        {pair ? <span className="lesson-pair">{t('{n} пара', { n: pair })}</span> : null}
        {(onEditNote || onMenu) && (
          <span className="lesson-actions">
            {onEditNote && (
              <button
                type="button"
                className="lesson-act"
                aria-label={note ? t('Изменить заметку к паре') : t('Добавить заметку к паре')}
                onClick={onEditNote}
              >
                <Icon name="pencil" size={19} strokeWidth={1.9} />
              </button>
            )}
            {onMenu && (
              <button type="button" className="lesson-act" aria-label={t('Действия с парой')} onClick={() => onMenu('menu')}>
                <MoreIcon width={19} height={4} />
              </button>
            )}
          </span>
        )}
      </div>

      {(lesson.kind || tags.length > 0) && (
        <div className="lesson-tags">
          {lesson.kind && <span className={`badge badge-${kindTone(lesson.kind)}`}>{trKind(lesson.kind)}</span>}
          {tags.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </div>
      )}

      <h3 className="lesson-subject">{subject}</h3>
      {/* по-английски — под переводом мелко оригинал, как в расписании ГУУ */}
      {subject !== lesson.subject && (
        <div className="lesson-subject-ru" lang="ru">
          {lesson.subject}
        </div>
      )}

      {(who.length > 0 || groups || roomText) && (
        <div className="lesson-who">
          {(who.length > 0 || groups) && (
            <div className="lesson-who-row">
              {who}
              {groups && (
                <span className="lesson-who-item">
                  <Icon name="people" size={16} strokeWidth={2} />
                  <span>{groups}</span>
                </span>
              )}
            </div>
          )}
          {roomText && (
            <div className="lesson-who-row">
              <span className="lesson-who-item lesson-room">
                <Icon name="map-pin" size={16} strokeWidth={2} />
                {onRoom ? (
                  <button type="button" className="lesson-link" onClick={() => onRoom(lesson.room!)}>
                    {roomText}
                  </button>
                ) : (
                  <span>{roomText}</span>
                )}
              </span>
            </div>
          )}
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
      {isNext && !live && <div className="lesson-soon">{t('через {d}', { d: formatDuration(start - nowMinutes!) })}</div>}

      {live && (
        <div className="lesson-live">
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
          </div>
          <span className="lesson-timer" aria-label={t('До конца пары {d}', { d: formatDuration(end - nowMinutes!) })}>
            <Icon name="clock" size={17} strokeWidth={2.1} />
            {formatDuration(end - nowMinutes!)}
          </span>
        </div>
      )}
    </article>
  )
}
