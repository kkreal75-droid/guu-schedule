import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { DayStrip } from '../components/DayStrip'
import { GroupChips } from '../components/GroupChips'
import { LessonCard } from '../components/LessonCard'
import { LessonMenu } from '../components/LessonMenu'
import { NoteEditor, type NoteTarget } from '../components/NoteEditor'
import { WeekCard } from '../components/WeekCard'
import { WEEKDAYS_FULL, WEEKDAYS_SHORT, formatDate, formatDuration, pluralPairs } from '../format'
import { CalendarIcon, NoteIcon } from '../icons'
import { dayLessons } from '../../shared/edits-core'
import type { DayLesson, Extras } from '../edits'
import type { HideScope } from '../hidden'
import { dayHasNotes, dayNoteKey, lessonNoteKey, type Notes } from '../notes'
import { dayFromIso, getTimetable, isoFromDay, moscowNow, toMinutes } from '../schedule'
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

const GAP_MIN = 60 // меньше часа между парами — «Перерыв», больше — «Окно»

type Props = {
  extras: Extras // правки (владелец, старосты), подгруппы
  mine?: number[] | null // выбранные подгруппы: чужие пары подгрупп не показываем
  group: string
  groups: string[] // своя группа и избранные — чипы над расписанием
  home?: string // своя группа (★)
  onGroupChange: (group: string) => void
  onAddGroup?: () => void // «+» у чипов — добавить группу в избранное
  cursor: Cursor
  onCursorChange: (cursor: Cursor) => void
  notes: Notes
  onSaveNote: (key: string, text: string) => void
  onTeacher?: (name: string) => void // нажатие на преподавателя в паре
  onRoom?: (room: string) => void // нажатие на аудиторию в паре
  // чужое расписание (группа из поиска, преподаватель): своё расписание, без заметок и шапки
  tt?: Timetable
  readOnly?: boolean
  // «Это не моя пара»: скрыть у себя (id правила — для «Вернуть»; null — не вышло) и вернуть; нет — нельзя
  onHide?: (lesson: DayLesson, date: string, scope: HideScope) => Promise<number | null>
  onUnhide?: (id: number) => void
}

const HIDDEN_TOAST: Record<HideScope, string> = {
  day: 'Пара скрыта в этот день',
  even: 'Пара скрыта по чётным неделям',
  odd: 'Пара скрыта по нечётным неделям',
  always: 'Пара скрыта',
}

export function ScheduleScreen({
  extras, mine = null, group, groups, home, onGroupChange, onAddGroup, cursor, onCursorChange, notes, onSaveNote,
  onTeacher, onRoom, tt, readOnly, onHide, onUnhide,
}: Props) {
  const T = tt ?? getTimetable()
  const { dayOf, weekOf, weekdayOf, inSemester } = T
  const MAX_WEEK = T.maxWeek
  const now = useNow()
  const [direction, setDirection] = useState<'fwd' | 'back' | null>(null)
  const [editing, setEditing] = useState<NoteTarget | null>(null)
  const [menu, setMenu] = useState<{ lesson: DayLesson; start: 'menu' | 'hide' } | null>(null)
  // «Пара скрыта · Вернуть» — 5 секунд после скрытия
  const [toast, setToast] = useState<{ text: string; id: number | null } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])
  const touch = useRef<{ x: number; y: number } | null>(null)
  const datePicker = useRef<HTMLInputElement>(null)

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
  const goDay = (d: number) => go({ week: weekOf(d), weekday: weekdayOf(d) })

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
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goDay(day + (dx < 0 ? 1 : -1))
  }

  // «Календарь»: выбор даты системным календарём
  const firstDay = dayOf(1, 0)
  const lastDay = dayOf(MAX_WEEK, 6)
  const openPicker = () => {
    haptic()
    const input = datePicker.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      input.focus()
      input.click()
    }
  }

  const nowMinutes = isToday ? now.minutes : null
  const nextIndex =
    nowMinutes === null ? -1 : lessons.findIndex((l) => !l.cancel && !l.movedTo && toMinutes(l.start) > nowMinutes)

  const dayKey = dayNoteKey(day)
  const dayNote = notes[dayKey]
  const editDayNote = () => {
    haptic()
    setEditing({ key: dayKey, title: 'Заметка к дню', subtitle: `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}` })
  }

  const summary = lessons.length ? `${pluralPairs(lessons.length)} · ${lessons[0].start}–${lessons[lessons.length - 1].end}` : null
  const dayLabel = `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)}`

  return (
    <div className="screen sched">
      {!readOnly && (
        <>
          <header className="screen-head">
            <h1 className="screen-title">Расписание</h1>
            <div className="screen-actions">
              <button
                type="button"
                className="round-btn round-btn-note"
                aria-label={dayNote ? 'Заметка к дню' : 'Добавить заметку к дню'}
                data-has-note={dayNote ? true : undefined}
                onClick={editDayNote}
              >
                <NoteIcon />
              </button>
              <button type="button" className="round-btn" aria-label="Выбрать дату" onClick={openPicker}>
                <CalendarIcon />
              </button>
              <input
                ref={datePicker}
                className="visually-hidden"
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                min={isoFromDay(firstDay)}
                max={isoFromDay(lastDay)}
                value={isoFromDay(day)}
                onChange={(e) => e.target.value && goDay(dayFromIso(e.target.value))}
              />
            </div>
          </header>
          <GroupChips value={group} groups={groups} home={home} onChange={onGroupChange} onAdd={onAddGroup} />
        </>
      )}

      <WeekCard
        week={week}
        day={day}
        monday={monday}
        prevDisabled={week <= 1}
        nextDisabled={week >= MAX_WEEK}
        onPrev={() => go({ week: week - 1, weekday })}
        onNext={() => go({ week: week + 1, weekday })}
      />

      <DayStrip
        monday={monday}
        weekday={weekday}
        today={now.day}
        busy={busyDays}
        notes={readOnly ? undefined : WEEKDAYS_SHORT.map((_, i) => dayHasNotes(notes, monday + i, group))}
        onPick={(i) => go({ week, weekday: i })}
      />

      <div className="day-sub">
        <span className="day-sub-text">
          {isToday ? 'Сегодня' : dayLabel}
          {summary && ` · ${summary}`}
        </span>
        {!isToday && inSemester(todayWeek) && (
          <button type="button" className="pill pill-btn" onClick={() => goDay(now.day)}>
            Сегодня
          </button>
        )}
      </div>

      <main className="content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div key={`${group}|${day}`} className={`day-list${direction ? ` slide-${direction}` : ''}`}>
          {view.notes.map((text, i) => (
            <div key={i} className="edit-note">
              📌 {text}
            </div>
          ))}
          {!readOnly && dayNote && (
            <button type="button" className="day-note" onClick={editDayNote}>
              <NoteIcon className="day-note-icon" />
              <span className="note-text">{dayNote}</span>
            </button>
          )}

          {lessons.length === 0 ? (
            <div className="empty">
              <div className="empty-emoji">{weekday === 6 ? '🌿' : '🎉'}</div>
              <div className="empty-title">{weekday === 6 ? 'Выходной' : 'Пар нет'}</div>
              <div className="empty-text">{inSemester(week) ? 'В этот день занятий нет' : 'Этот день вне семестра'}</div>
            </div>
          ) : (
            lessons.map((lesson, i) => {
              const gap = i > 0 ? toMinutes(lesson.start) - toMinutes(lessons[i - 1].end) : 0
              const noteKey = lessonNoteKey(day, group, lesson)
              const editNote = () => {
                haptic()
                setEditing({
                  key: noteKey,
                  title: lesson.subject,
                  subtitle: `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)} · ${lesson.start}–${lesson.end}`,
                })
              }
              return (
                <div key={`${lesson.start}|${lesson.subject}|${lesson.kind}`} className="day-item">
                  {gap > 0 && (
                    <div className="gap" data-window={gap >= GAP_MIN || undefined}>
                      {gap >= GAP_MIN ? 'Окно' : 'Перерыв'} {formatDuration(gap)}
                    </div>
                  )}
                  <LessonCard
                    lesson={lesson}
                    nowMinutes={nowMinutes}
                    isNext={i === nextIndex}
                    pair={lesson.pair ?? (lesson.added || lesson.movedFrom ? null : T.pairNumber(lesson))}
                    note={readOnly ? undefined : notes[noteKey]}
                    onTeacher={onTeacher}
                    onRoom={onRoom}
                    onEditNote={readOnly ? undefined : editNote}
                    onMenu={readOnly ? undefined : (start) => (haptic(), setMenu({ lesson, start }))}
                  />
                </div>
              )
            })
          )}
        </div>
      </main>

      {menu && (
        <LessonMenu
          lesson={menu.lesson}
          subtitle={`${WEEKDAYS_FULL[weekday]}, ${formatDate(day)} · ${menu.lesson.start}–${menu.lesson.end}`}
          week={week}
          start={menu.start}
          onNote={() => {
            const lesson = menu.lesson
            setMenu(null)
            setEditing({
              key: lessonNoteKey(day, group, lesson),
              title: lesson.subject,
              subtitle: `${WEEKDAYS_FULL[weekday]}, ${formatDate(day)} · ${lesson.start}–${lesson.end}`,
            })
          }}
          onHide={
            onHide &&
            (async (scope) => {
              const lesson = menu.lesson
              setMenu(null)
              const id = await onHide(lesson, isoFromDay(day), scope)
              if (id !== null) setToast({ text: HIDDEN_TOAST[scope], id })
            })
          }
          onClose={() => setMenu(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.id !== null && onUnhide && (
            <button
              type="button"
              className="toast-btn"
              onClick={() => {
                haptic()
                onUnhide(toast.id!)
                setToast(null)
              }}
            >
              Вернуть
            </button>
          )}
        </div>
      )}

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
