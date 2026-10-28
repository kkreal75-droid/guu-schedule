import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from 'react'
import { DayStrip } from '../components/DayStrip'
import { LessonCard } from '../components/LessonCard'
import { ProjectDay } from '../components/Events'
import { LessonMenu } from '../components/LessonMenu'
import { NoteEditor, type NoteTarget } from '../components/NoteEditor'
import { WeekCard } from '../components/WeekCard'
import { WEEK_INDEXES, formatDate, formatDuration, pluralPairs, shortTime, weekdayFull } from '../format'
import { dayLessons } from '../../shared/edits-core'
import type { DayLesson, Extras } from '../edits'
import type { HideScope } from '../hidden'
import { dayHasNotes, dayNoteKey, lessonNoteKey, type Notes } from '../notes'
import { dayFromIso, getTimetable, isoFromDay, moscowNow, toMinutes } from '../schedule'
import { dayOffTitle, isTeacherKey, type Timetable } from '../../shared/schedule-core'
import { courseKey, courseOccurrences, occurrenceIndex, progressOf } from '../../shared/progress-core'
import type { GroupInfo } from '../../shared/groups'
import { loadGroups } from '../data'
import { mergeStreams, type ShownLesson } from '../lessons'
import { isProjectLesson } from '../../shared/events-core'
import { haptic } from '../telegram'
import { ChevronDown, Icon } from '../icons'
import { getLang, t } from '../i18n'
import { groupSubtitleParts, trSubject } from '../guu'

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
  bar?: ReactNode // лента избранного над расписанием (своё ★ и избранное)
  onGroup?: (group: string) => void // нажатие на группу у пары преподавателя — её расписание
  cursor: Cursor
  onCursorChange: (cursor: Cursor) => void
  notes: Notes
  onSaveNote: (key: string, text: string) => void
  onTeacher?: (name: string) => void // нажатие на преподавателя в паре
  onRoom?: (room: string) => void // нажатие на аудиторию в паре
  onEvents?: () => void // «Все мероприятия» в блоке проектного обучения — «Сервисы → Мероприятия ГУУ»
  updated?: ReactNode // «Обновлено …» — под сообщением «Выходной» или в конце дня
  // чужое расписание (группа из поиска, преподаватель): своё расписание, без заметок и шапки
  tt?: Timetable
  readOnly?: boolean
  // «Это не моя пара»: скрыть у себя (id правила — для «Вернуть»; null — не вышло) и вернуть; нет — нельзя
  onHide?: (lesson: DayLesson, date: string, scope: HideScope) => Promise<number | null>
  onUnhide?: (id: number) => void
}

const hiddenToast = (scope: HideScope) =>
  ({
    day: t('Пара скрыта в этот день'),
    even: t('Пара скрыта по чётным неделям'),
    odd: t('Пара скрыта по нечётным неделям'),
    always: t('Пара скрыта'),
  })[scope]

export function ScheduleScreen({
  extras, mine = null, group, bar, onGroup, cursor, onCursorChange, notes, onSaveNote,
  onTeacher, onRoom, onEvents, updated, tt, readOnly, onHide, onUnhide,
}: Props) {
  const T = tt ?? getTimetable()
  const { dayOf, weekOf, weekdayOf, inSemester } = T
  const MAX_WEEK = T.maxWeek
  const now = useNow()
  const [direction, setDirection] = useState<'fwd' | 'back' | null>(null)
  const [editing, setEditing] = useState<NoteTarget | null>(null)
  const [menu, setMenu] = useState<{ lesson: ShownLesson; start: 'menu' | 'hide' } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
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

  // пары дня со всеми правками и подгруппами (shared/edits-core.ts); у преподавателя пара потока у нескольких
  // групп — одной карточкой, накладки помечены (src/lessons.ts)
  const teacherView = isTeacherKey(group)
  const view = useMemo(() => dayLessons(T, group, day, extras, mine), [T, group, day, extras, mine])
  const lessons: ShownLesson[] = useMemo(() => (teacherView ? mergeStreams(view.lessons) : view.lessons), [view, teacherView])
  // день «Проектного обучения» (этап 13): все пары — оно → шапка и мероприятия make.events вместо шести карточек;
  // у группы в этот день свои пары (четверг МБ) — они, а под ними свёрнутая карточка мероприятий
  const project = teacherView ? [] : lessons.filter(isProjectLesson)
  const shown = project.length ? lessons.filter((l) => !isProjectLesson(l)) : lessons

  // ход предметов за семестр (этап 12): «занятие N из M», «последнее занятие»
  const courses = useMemo(() => courseOccurrences(T, group, extras, mine), [T, group, extras, mine])
  const lastHere = useMemo(() => {
    const keys = new Set<string>()
    for (const l of view.lessons) {
      const last = courses.get(courseKey(l))?.at(-1)
      if (last && last.day === day && last.start === l.start) keys.add(`${l.start}|${l.subject}`)
    }
    return keys
  }, [view, courses, day])
  const progressFor = (lesson: ShownLesson) => {
    const list = courses.get(courseKey(lesson))
    const progress = list && progressOf(list, now)
    return progress ? { ...progress, index: occurrenceIndex(list, day, lesson.start) } : null
  }

  // у пар преподавателя — группы: полное название (программа, институт, курс) — подсказкой
  const [groupsInfo, setGroupsInfo] = useState<Map<string, GroupInfo> | null>(null)
  useEffect(() => {
    if (!teacherView || groupsInfo) return
    loadGroups().then((index) => setGroupsInfo(new Map(index.groups.map((g) => [g.id, g]))), () => {})
  }, [teacherView, groupsInfo])
  const groupTitle = (id: string, name: string) => {
    const info = groupsInfo?.get(id)
    return info ? `${name} — ${groupSubtitleParts(info).join(' · ')}` : name
  }
  const busyDays = useMemo(
    () => WEEK_INDEXES.map((_, i) => dayLessons(T, group, monday + i, extras, mine).lessons.length > 0),
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
    nowMinutes === null ? -1 : shown.findIndex((l) => !l.cancel && !l.movedTo && toMinutes(l.start) > nowMinutes)

  const dayKey = dayNoteKey(day)
  const dayNote = notes[dayKey]
  const dayLabel = `${weekdayFull(weekday)}, ${formatDate(day)}`
  const editDayNote = () => {
    haptic()
    setEditing({ key: dayKey, title: t('Заметка к дню'), subtitle: dayLabel })
  }
  // «Макроэкономика · пятница, 10:40»
  const lessonNote = (lesson: ShownLesson): NoteTarget => ({
    key: lessonNoteKey(day, group, lesson),
    title: t('Заметка к паре'),
    subtitle: `${trSubject(lesson.subject)} · ${getLang() === 'ru' ? weekdayFull(weekday).toLowerCase() : weekdayFull(weekday)}, ${shortTime(lesson.start)}`,
  })

  // «4 пары»
  const summary = project.length && !shown.length ? t('Проектное обучение') : lessons.length ? pluralPairs(lessons.length) : null

  // пар нет: выходной для всех (days_off), воскресенье и другие дни без пар — «Выходной»; вне семестра — «Пар нет»
  const empty = view.dayOff
    ? { title: t('Выходной'), text: dayOffTitle(view.dayOff, getLang()) }
    : inSemester(week)
      ? { title: t('Выходной'), text: t('В этот день пар нет.') }
      : { title: t('Пар нет'), text: t('Этот день вне семестра') }

  return (
    <div className="screen sched">
      {!readOnly && (
        <>
          <header className="sched-head">
            {/* дата открывает выбор даты; справа — заметка к дню */}
            <h1 className="sched-date">
              <button type="button" className="sched-date-btn" aria-label={t('Выбрать дату')} onClick={openPicker}>
                <span>{dayLabel}</span>
                <ChevronDown className="sched-date-arrow" />
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
            </h1>
            <button
              type="button"
              className={`sched-act${dayNote ? ' sched-act-on' : ''}`}
              aria-label={dayNote ? t('Заметка к дню') : t('Добавить заметку к дню')}
              onClick={editDayNote}
            >
              <Icon name="note" />
            </button>
          </header>
          {bar}
        </>
      )}

      <WeekCard
        week={week}
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
        notes={readOnly ? undefined : WEEK_INDEXES.map((_, i) => dayHasNotes(notes, monday + i, group))}
        onPick={(i) => go({ week, weekday: i })}
      />

      {(summary || (!isToday && inSemester(todayWeek))) && (
        <div className="day-sub">
          <span>{summary}</span>
          {!isToday && inSemester(todayWeek) && (
            <button type="button" className="link-btn day-today" onClick={() => goDay(now.day)}>
              {t('Сегодня')}
            </button>
          )}
        </div>
      )}

      <main className="content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div key={`${group}|${day}`} className={`day-list${direction ? ` slide-${direction}` : ''}`}>
          {view.notes.map((text, i) => (
            <div key={i} className="day-note">
              <Icon name="pin" size={17} />
              <span>{text}</span>
            </div>
          ))}
          {!readOnly && dayNote && (
            <button type="button" className="day-note" onClick={editDayNote}>
              <Icon name="note" size={17} />
              <span>{dayNote}</span>
            </button>
          )}

          {lessons.length === 0 ? (
            <div className="empty">
              <div className="empty-emoji">😎</div>
              <div className="empty-title">{empty.title}</div>
              <div className="empty-text">{empty.text}</div>
              {updated && <div className="empty-updated">{updated}</div>}
            </div>
          ) : project.length && !shown.length ? (
            <ProjectDay iso={isoFromDay(day)} onAll={onEvents} />
          ) : (
            shown.map((lesson, i) => {
              const gap = i > 0 ? toMinutes(lesson.start) - toMinutes(shown[i - 1].end) : 0
              const noteKey = lessonNoteKey(day, group, lesson)
              const editNote = () => {
                haptic()
                setEditing(lessonNote(lesson))
              }
              return (
                <div key={`${lesson.start}|${lesson.subject}|${lesson.kind}`} className="day-item" style={{ '--i': i } as CSSProperties}>
                  {gap > 0 && (
                    <div className="gap">
                      {gap >= GAP_MIN ? t('Окно {d}', { d: formatDuration(gap) }) : t('Перерыв {d}', { d: formatDuration(gap) })}
                    </div>
                  )}
                  <LessonCard
                    lesson={lesson}
                    nowMinutes={nowMinutes}
                    isNext={i === nextIndex}
                    pair={lesson.pair ?? (lesson.added || lesson.movedFrom ? null : T.pairNumber(lesson))}
                    note={readOnly ? undefined : notes[noteKey]}
                    last={lastHere.has(`${lesson.start}|${lesson.subject}`)}
                    showWeeks={teacherView}
                    onTeacher={onTeacher}
                    onRoom={onRoom}
                    onGroup={onGroup}
                    groupTitle={groupTitle}
                    onEditNote={readOnly ? undefined : editNote}
                    onOpen={() => (haptic(), setMenu({ lesson, start: 'menu' }))}
                    onMenu={readOnly ? undefined : (start) => (haptic(), setMenu({ lesson, start }))}
                  />
                </div>
              )
            })
          )}
          {project.length > 0 && shown.length > 0 && (
            <ProjectDay key={day} iso={isoFromDay(day)} from={project[0].start} to={project[project.length - 1].end} onAll={onEvents} />
          )}
          {lessons.length > 0 && updated && <p className="updated">{updated}</p>}
        </div>
      </main>

      {menu && (
        <LessonMenu
          lesson={menu.lesson}
          subtitle={`${dayLabel}, ${shortTime(menu.lesson.start)}–${shortTime(menu.lesson.end)}`}
          week={week}
          start={menu.start}
          progress={progressFor(menu.lesson)}
          actions={!readOnly}
          onNote={() => {
            const lesson = menu.lesson
            setMenu(null)
            setEditing(lessonNote(lesson))
          }}
          onHide={
            onHide &&
            (async (scope) => {
              const lesson = menu.lesson
              setMenu(null)
              const id = await onHide(lesson, isoFromDay(day), scope)
              if (id !== null) setToast({ text: hiddenToast(scope), id })
            })
          }
          onClose={closeMenu}
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
              {t('Вернуть')}
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
