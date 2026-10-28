import { useRef } from 'react'
import { formatDuration, shortTime, weeksText } from '../format'
import { shortWhen } from '../../shared/edits-core'
import type { ShownLesson } from '../lessons'
import { toMinutes } from '../schedule'
import { haptic } from '../telegram'
import { t } from '../i18n'
import { roomLabel, trKind, trSubject, trTeacher } from '../guu'

// метка вида занятия: лекция — серая, практика и семинары — светло-красная, остальное — белая с красной рамкой
const KIND_TONE: Record<string, string> = { Лекция: 'lecture', Практика: 'practice', Семинар: 'practice' } // i18n-ignore — виды из файлов ГУУ
export const kindTone = (kind: string | null) => (kind && KIND_TONE[kind]) || 'other'

const Emoji = ({ e }: { e: string }) => (
  <span className="lesson-emoji" aria-hidden="true">
    {e}
  </span>
)

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

// Карточка пары: время начала крупно, номер пары, ✏️ (заметка) и ··· (действия); метка вида, предмет, синие
// «👤 преподаватель» и «📍 аудитория» (у преподавателя — «👥 группы»). Идёт сейчас — красная рамка и полоска
// времени «⏳ 34 мин», следующая — «через 1 ч 19 мин», прошедшие — бледнее.
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
                ✏️
              </button>
            )}
            {onMenu && (
              <button type="button" className="lesson-act lesson-dots" aria-label={t('Действия с парой')} onClick={() => onMenu('menu')}>
                ···
              </button>
            )}
          </span>
        )}
      </div>

      <div className="lesson-body">
        {(lesson.kind || lesson.added || lesson.subgroup || last || lesson.overlap) && (
          <div className="lesson-tags">
            {lesson.kind && <span className={`badge badge-${kindTone(lesson.kind)}`}>{trKind(lesson.kind)}</span>}
            {lesson.added && <span className="badge badge-practice">{t('добавлена')}</span>}
            {lesson.subgroup && <span className="badge">{lesson.subgroup.name}</span>}
            {last && !lesson.cancel && !lesson.movedTo && <span className="badge badge-other">{t('последнее занятие')}</span>}
            {lesson.overlap && <span className="badge badge-practice">{t('накладка в расписании')}</span>}
          </div>
        )}
        <h3 className="lesson-subject">{subject}</h3>
        {/* по-английски — под переводом мелко оригинал, как в расписании ГУУ */}
        {subject !== lesson.subject && (
          <div className="lesson-subject-ru" lang="ru">
            {lesson.subject}
          </div>
        )}

        {(teachers.length > 0 || groupLabels.length > 0 || lesson.room) && (
          <div className="lesson-links">
            {teachers.map((name) =>
              onTeacher ? (
                <button key={name} type="button" className="lesson-link" onClick={() => onTeacher(name)}>
                  <Emoji e="👤" />
                  {trTeacher(name)}
                </button>
              ) : (
                <span key={name} className="lesson-link">
                  <Emoji e="👤" />
                  {trTeacher(name)}
                </span>
              ),
            )}
            {audience && audience.length > 0 && (
              <span className="lesson-link lesson-groups">
                <Emoji e="👥" />
                {audience.map((g, i) => {
                  const title = groupTitle?.(g.id, g.name) ?? g.name
                  return (
                    <span key={g.id}>
                      {i > 0 && ', '}
                      {onGroup ? (
                        <button type="button" className="lesson-group" title={title} aria-label={title} onClick={() => (haptic(), onGroup(g.id))}>
                          <span lang="ru">{groupLabels[i]}</span>
                        </button>
                      ) : (
                        <span lang="ru" title={title}>
                          {groupLabels[i]}
                        </span>
                      )}
                    </span>
                  )
                })}
              </span>
            )}
            {lesson.room &&
              (onRoom ? (
                <button type="button" className="lesson-link" onClick={() => onRoom(lesson.room!)}>
                  <Emoji e="📍" />
                  {roomText}
                </button>
              ) : (
                <span className="lesson-link">
                  <Emoji e="📍" />
                  {roomText}
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
        {lesson.movedFrom && <div className="lesson-line">{t('↩️ Перенос с {when}', { when: shortWhen(lesson.movedFrom.date, lesson.movedFrom.start) })}</div>}
        {lesson.notes.map((text, i) => (
          <div key={i} className="lesson-line">
            📌 {text}
          </div>
        ))}
        {note && (
          <button type="button" className="lesson-line lesson-note" onClick={onEditNote}>
            📝 {note}
          </button>
        )}
        {isNext && !live && <div className="lesson-soon">{t('через {d}', { d: formatDuration(start - nowMinutes!) })}</div>}
      </div>

      {live && (
        <div className="lesson-live">
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${((nowMinutes! - start) / (end - start)) * 100}%` }} />
          </div>
          <span className="lesson-timer" aria-label={t('До конца пары {d}', { d: formatDuration(end - nowMinutes!) })}>
            ⏳ {formatDuration(end - nowMinutes!)}
          </span>
        </div>
      )}
    </article>
  )
}
