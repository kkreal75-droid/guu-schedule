import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { LessonCard } from '../components/LessonCard'
import { NoteEditor, type NoteTarget } from '../components/NoteEditor'
import { GroupSwitch } from '../components/GroupSwitch'
import {
  WEEKDAYS_FULL, WEEKDAYS_SHORT, dateOf, formatDate, formatDuration, formatRange, pluralPairs, weekTitle,
} from '../format'
import { ChevronLeft, ChevronRight, NoteIcon, PlusIcon } from '../icons'
import { dayLessons } from '../../shared/edits-core'
import type { Extras } from '../edits'
import { dayHasNotes, dayNoteKey, lessonNoteKey, type Notes } from '../notes'
import { getTimetable, moscowNow, toMinutes } from '../schedule'
import type { Timetable } from '../../shared/schedule-core'
import { haptic } from '../telegram'

export type Cursor = { week: number; weekday: number }

export function initialCursor(tt: Timetable = getTimetable()): Cursor {
  const { day } = moscowNow()
  const week = tt.weekOf(day)
  if (week < 1) return { week: 1, weekday: 0 }
  if (week > tt.maxWeek) return { week: tt.maxWeek, weekday: 0 }
  return { week, weekday: tt.weekdayOf(day) }
}

function useNow() {
  const [now, setNow] = useState(moscowNow)
  useEffect(() => {
    const tick = () => setNow(moscowNow())
    const id = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

const GAP_MIN = 60 // показываем «окно», если между парами час и больше

type Props = {
  extras: Extras // правки (владелец, старосты), подгруппы
  mine?: number[] | null // выбранные подгруппы: чужие пары подгрупп не показываем
  group: string
  groups: string[] // своя группа и избранные — для переключателя
  onGroupChange: (group: string) => void
  cursor: Cursor
  onCursorChange: (cursor: Cursor) => void
  notes: Notes
  onSaveNote: (key: string, text: string) => void
  // чужое расписание (группа из поиска, преподаватель): своё расписание, без заметок
  tt?: Timetable
  readOnly?: boolean
}

export function ScheduleScreen({
  extras, mine = null, group, groups, onGroupChange, cursor, onCursorChange, notes, onSaveNote, tt, readOnly,
}: Props) {
  const T = tt ?? getTimetable()
  const { dayOf, weekOf, weekdayOf, inSemester } = T
  const MAX_WEEK = T.maxWeek
  const now = useNow()
  const [direction, setDirection] = useState<'fwd' | 'back' | null>(null)
  const [editing, setEditing] = useState<NoteTarget | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)

  const { week, weekday } = cursor
  const day = dayOf(week, weekday)
  const monday = dayOf(week, 0)
  const todayWeek = weekOf(now.day)
  const isToday = day === now.day

  // пары дня со всеми правками и подгруппами (shared/edits-core.ts)
  const view = useMemo(() => dayLessons(T, group, day, extras, mine), [T, group, day, extras, mine])
  const lessons = view.lessons
  const busyDays = useMemo(
    () => WEEKDAYS_SHORT.map((_, i) => dayLessons(T, group, monday + i, extras, mine).lessons.length > 0),
    [T, group, monday, extras, mine],
  )

  const go = (next: Cursor) => {
    if (!inSemester(next.week)) return
    const target = dayOf(next.week, next.weekday)
    if (target === day) return
    setDirection(target > day ? 'fwd' : 'back')
    haptic()
    onCursorChange(next)
  }
  const shiftDay = (delta: number) => {
    const d = day + delta
    go({ week: weekOf(d), weekday: weekdayOf(d) })
  }

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
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftDay(dx < 0 ? 1 : -1)
  }

  const nowMinutes = isToday ? now.minutes : null
  const nextIndex =
    nowMinutes === null
      ? -1
      : lessons.findIndex((l) => !l.cancel && !l.movedTo && toMinutes(l.start) > nowMinutes)

  const dayHint = [
    day === now.day + 1 ? 'Завтра' : day === now.day - 1 ? 'Вчера' : null,
    lessons.length ? `${pluralPairs(lessons.length)} · ${lessons[0].start}–${lessons[lessons.length - 1].end}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const dayKey = dayNoteKey(day)
  const dayNote = notes[dayKey]
  const editDayNote = () =>
    setEditing({ key: dayKey, title: 'Заметка к дню', subtitle: `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}` })

  return (
    <div className="screen">
      <header className="top">
        {!readOnly && <GroupSwitch value={group} groups={groups} onChange={onGroupChange} />}

        <div className="weeknav">
          <button
            type="button"
            className="icon-btn"
            aria-label="Предыдущая неделя"
            disabled={week <= 1}
            onClick={() => go({ week: week - 1, weekday })}
          >
            <ChevronLeft />
          </button>
          <div className="weeknav-title">
            <div className="weeknav-main">{weekTitle(week)}</div>
            <div className="weeknav-sub">{formatRange(monday, monday + 6)}</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Следующая неделя"
            disabled={week >= MAX_WEEK}
            onClick={() => go({ week: week + 1, weekday })}
          >
            <ChevronRight />
          </button>
        </div>

        <div className="days" role="tablist" aria-label="Дни недели">
          {WEEKDAYS_SHORT.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              className="day"
              aria-selected={i === weekday}
              aria-label={`${WEEKDAYS_FULL[i]}, ${formatDate(monday + i)}`}
              data-today={monday + i === now.day || undefined}
              onClick={() => go({ week, weekday: i })}
            >
              <span className="day-wd">{label}</span>
              <span className="day-num">{dateOf(monday + i).date}</span>
              <span className="day-dots">
                <span className="day-dot" data-on={busyDays[i] || undefined} />
                {!readOnly && dayHasNotes(notes, monday + i, group) && <span className="day-dot day-dot-note" />}
              </span>
            </button>
          ))}
        </div>
      </header>

      <main className="content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="day-head">
          <div>
            <h2>
              {WEEKDAYS_FULL[weekday]}, {formatDate(day)}
            </h2>
            {dayHint && <p className="day-hint">{dayHint}</p>}
          </div>
          {isToday ? (
            <span className="pill">Сегодня</span>
          ) : (
            inSemester(todayWeek) && (
              <button
                type="button"
                className="pill pill-btn"
                onClick={() => go({ week: todayWeek, weekday: weekdayOf(now.day) })}
              >
                К сегодня
              </button>
            )
          )}
        </div>

        <div key={`${group}|${day}`} className={`day-list${direction ? ` slide-${direction}` : ''}`}>
          {view.notes.map((text, i) => (
            <div key={i} className="edit-note">
              📌 {text}
            </div>
          ))}
          {readOnly ? null : dayNote ? (
            <button type="button" className="day-note" onClick={editDayNote}>
              <NoteIcon className="day-note-icon" />
              <span className="note-text">{dayNote}</span>
            </button>
          ) : (
            <button type="button" className="note-add" onClick={editDayNote}>
              <PlusIcon /> Заметка к дню
            </button>
          )}

          {lessons.length === 0 ? (
            <div className="empty">
              <div className="empty-emoji">{weekday === 6 ? '🌿' : '☕️'}</div>
              <div className="empty-title">{weekday === 6 ? 'Выходной' : 'Пар нет'}</div>
              <div className="empty-text">В этот день занятий нет</div>
            </div>
          ) : (
            lessons.map((lesson, i) => {
              const gap = i > 0 ? toMinutes(lesson.start) - toMinutes(lessons[i - 1].end) : 0
              const noteKey = lessonNoteKey(day, group, lesson)
              return (
                <div key={`${lesson.start}|${lesson.subject}|${lesson.kind}`} className="day-item">
                  {gap >= GAP_MIN && <div className="gap">Окно · {formatDuration(gap)}</div>}
                  <LessonCard
                    lesson={lesson}
                    nowMinutes={nowMinutes}
                    isNext={i === nextIndex}
                    pair={lesson.pair ?? (lesson.added || lesson.movedFrom ? null : T.pairNumber(lesson))}
                    note={readOnly ? undefined : notes[noteKey]}
                    onEditNote={readOnly ? undefined : () =>
                      setEditing({
                        key: noteKey,
                        title: lesson.subject,
                        subtitle: `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)} · ${lesson.start}–${lesson.end}`,
                      })
                    }
                  />
                </div>
              )
            })
          )}
        </div>
      </main>

      {editing && (
        <NoteEditor
          key={editing.key}
          target={editing}
          initial={notes[editing.key] ?? ''}
          onClose={(text) => {
            onSaveNote(editing.key, text)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
