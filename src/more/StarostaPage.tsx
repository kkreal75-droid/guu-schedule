import { useEffect, useMemo, useState } from 'react'
import { describeEdit, type EditKind, type Extras, type LessonTag, type ScheduleEdit, type Subgroup } from '../../shared/edits-core'
import type { Timetable } from '../../shared/schedule-core'
import { ApiError, callBot } from '../api'
import { Segmented } from '../components/Segmented'
import { Section } from '../components/Section'
import { WEEKDAYS_FULL, WEEKDAYS_SHORT } from '../format'
import { buildTimetable, dayFromIso, fetchGroup, groupName, isoFromDay, moscowNow } from '../schedule'
import { confirmAction, haptic } from '../telegram'

// «Ещё → Правки группы» — только старосте (назначает владелец) и только своей группы.
// Правки видят все: приложение, /today, inline, беседы, календарь. Владелец видит автора и может откатить.

type Info = {
  group: string
  edits: (ScheduleEdit & { mine: boolean; by_owner: boolean })[]
  subgroups: Subgroup[]
  tags: LessonTag[]
}

const KINDS: { value: EditKind; label: string }[] = [
  { value: 'cancel', label: 'Отменить' },
  { value: 'note', label: 'Пометка' },
  { value: 'move', label: 'Перенос' },
  { value: 'add', label: 'Добавить' },
]
const LESSON_KINDS = ['Лекция', 'Практика', 'Лабораторная']
// дневные и вечерние пары ГУУ — для «Добавить» и «Перенос»
const SLOTS = [
  ['09:00', '10:30'], ['10:40', '12:10'], ['12:55', '14:25'], ['14:35', '16:05'],
  ['16:15', '17:45'], ['17:55', '19:25'], ['18:50', '20:20'], ['20:30', '22:00'],
]

const errorText = (err: unknown) =>
  err instanceof ApiError && !/^[a-z -]+$/.test(err.code) ? err.code : 'Не получилось. Попробуйте ещё раз.'

export function StarostaPage({ group, onExtras }: { group: string; onExtras: (group: string, extras: Extras) => void }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [tt, setTt] = useState<Timetable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  // форма правки
  const today = isoFromDay(moscowNow().day)
  const [kind, setKind] = useState<EditKind>('cancel')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [slot, setSlot] = useState(0)
  const [toDate, setToDate] = useState(today)
  const [room, setRoom] = useState('')
  const [subject, setSubject] = useState('')
  const [lessonKind, setLessonKind] = useState('Практика')
  const [teacher, setTeacher] = useState('')
  const [subgroup, setSubgroup] = useState<number | null>(null)
  // подгруппы
  const [newSub, setNewSub] = useState('')
  const [tagDay, setTagDay] = useState(0)

  const apply = (next: Info) => {
    setInfo(next)
    onExtras(group, { edits: next.edits, subgroups: next.subgroups, tags: next.tags })
  }
  useEffect(() => {
    callBot<Info>('/starosta/info').then(setInfo, () => setError('Не получилось загрузить правки группы.'))
    fetchGroup(group).then((f) => setTt(buildTimetable([f])), () => setError('Не получилось загрузить расписание группы.'))
  }, [group])

  // пары выбранного дня (из файла ГУУ) — что отменить, пометить, перенести
  const dayPairs = useMemo(() => {
    if (!tt) return []
    const day = dayFromIso(date)
    const week = tt.weekOf(day)
    return tt.inSemester(week) ? tt.lessonsOn(group, week, tt.weekdayOf(day)) : []
  }, [tt, date, group])

  // пары недели по дням (без повторов) — какие отметить подгруппой
  const weekPairs = useMemo(() => {
    if (!tt) return []
    const seen = new Map<string, { start: string; subject: string; teacher: string | null }>()
    for (const l of tt.schedule.lessons.filter((x) => x.group === group && x.weekday === tagDay)) {
      seen.set(`${l.start}|${l.subject}|${l.teacher ?? ''}`, { start: l.start, subject: l.subject, teacher: l.teacher })
    }
    return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start))
  }, [tt, tagDay, group])

  const run = async (path: string, payload: object, done: string) => {
    setBusy(true)
    setFlash(null)
    try {
      apply(await callBot<Info>(path, payload))
      haptic('light')
      setFlash(done)
      return true
    } catch (err) {
      setFlash(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="lead">{error}</p>
  if (!info || !tt) return <p className="lead">Загружаю…</p>

  const submit = async () => {
    const [s, e] = SLOTS[slot]
    const payload: Record<string, unknown> = { kind, date, start: kind === 'add' ? null : start, text }
    if (kind === 'move') payload.data = { to_date: toDate, to_start: s, to_end: e, room }
    if (kind === 'add') payload.data = { start: s, end: e, subject, kind: lessonKind, teacher, room, subgroup }
    if (await run('/starosta/edit-add', payload, 'Правка сохранена — её увидят все')) {
      setText('')
      setStart(null)
    }
  }

  const active = info.edits.filter((e) => e.date >= today || (e.kind === 'move' && (e.data as { to_date?: string })?.to_date! >= today))

  return (
    <div className="page-body">
      <p className="lead">
        Вы — староста <b>{groupName(group)}</b>. Правки видят все: приложение, бот, беседы, календарь.
      </p>

      <Section title="Новая правка">
        <div className="form">
          <Segmented label="Что сделать" value={kind} options={KINDS} onChange={(k) => (setKind(k), setFlash(null))} />
          <label className="field">
            <span>{kind === 'add' ? 'День' : 'День пары'}</span>
            <input className="input" type="date" value={date} onChange={(e) => (setDate(e.target.value), setStart(null))} />
          </label>

          {kind !== 'add' && (
            <div className="row-chips">
              {kind === 'note' && (
                <button type="button" className="chip" aria-pressed={start === null} onClick={() => setStart(null)}>
                  Весь день
                </button>
              )}
              {dayPairs.length === 0 && <span className="section-footer">В этот день пар нет</span>}
              {dayPairs.map((l) => (
                <button key={`${l.start}|${l.subject}`} type="button" className="chip" aria-pressed={start === l.start} onClick={() => setStart(l.start)}>
                  {l.start} · {l.subject.slice(0, 28)}
                </button>
              ))}
            </div>
          )}

          {(kind === 'move' || kind === 'add') && (
            <>
              {kind === 'move' && (
                <label className="field">
                  <span>Перенести на</span>
                  <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </label>
              )}
              <div className="row-chips">
                {SLOTS.map(([s, e], i) => (
                  <button key={s} type="button" className="chip" aria-pressed={slot === i} onClick={() => setSlot(i)}>
                    {s}–{e}
                  </button>
                ))}
              </div>
              {kind === 'add' && (
                <>
                  <input className="input" placeholder="Предмет" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
                  <Segmented
                    label="Вид"
                    value={lessonKind}
                    options={LESSON_KINDS.map((k) => ({ value: k, label: k }))}
                    onChange={setLessonKind}
                  />
                  <input className="input" placeholder="Преподаватель (необязательно)" value={teacher} maxLength={80} onChange={(e) => setTeacher(e.target.value)} />
                  {info.subgroups.length > 0 && (
                    <div className="row-chips">
                      <button type="button" className="chip" aria-pressed={subgroup === null} onClick={() => setSubgroup(null)}>
                        Вся группа
                      </button>
                      {info.subgroups.map((s) => (
                        <button key={s.id} type="button" className="chip" aria-pressed={subgroup === s.id} onClick={() => setSubgroup(s.id)}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <input className="input" placeholder="Аудитория (необязательно)" value={room} maxLength={30} onChange={(e) => setRoom(e.target.value)} />
            </>
          )}

          <input
            className="input"
            placeholder={kind === 'note' ? 'Текст пометки' : 'Комментарий (необязательно)'}
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="button-primary" disabled={busy} onClick={submit}>
            Сохранить правку
          </button>
          {flash && <p className="section-footer">{flash}</p>}
        </div>
      </Section>

      <Section title={`Правки группы (${active.length})`} footer="Правки владельца бота убрать нельзя. Владелец видит все правки и может их откатить.">
        {active.length === 0 && <div className="row row-text">Пока правок нет</div>}
        {active.map((e) => (
          <div key={e.id} className="row admin-msg">
            <div className="admin-msg-body">
              <div className="admin-msg-text">{describeEdit(e)}</div>
              <div className="admin-msg-meta">{e.by_owner ? 'владелец' : e.mine ? 'вы' : 'староста'}</div>
            </div>
            {!e.by_owner && (
              <button
                type="button"
                className="button-inline danger"
                disabled={busy}
                onClick={async () => {
                  if (await confirmAction('Убрать эту правку?')) await run('/starosta/edit-delete', { id: e.id }, 'Правка убрана')
                }}
              >
                Убрать
              </button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Подгруппы" footer="Например, «Англ — Цунаева» и «Англ — Замятина». Студенты выбирают свою в «Профиле» и видят только свои пары.">
        {info.subgroups.map((s) => (
          <div key={s.id} className="row">
            <span>{s.name}</span>
            <button
              type="button"
              className="button-inline danger"
              disabled={busy}
              onClick={async () => {
                if (await confirmAction(`Удалить подгруппу «${s.name}»? Пары перестанут к ней относиться.`)) {
                  await run('/starosta/subgroup-delete', { id: s.id }, 'Подгруппа удалена')
                }
              }}
            >
              Удалить
            </button>
          </div>
        ))}
        <div className="row row-form">
          <input className="input" placeholder="Название подгруппы" value={newSub} maxLength={40} onChange={(e) => setNewSub(e.target.value)} />
          <button
            type="button"
            className="button-inline"
            disabled={busy || newSub.trim().length < 2}
            onClick={async () => {
              if (await run('/starosta/subgroup-add', { name: newSub }, 'Подгруппа добавлена')) setNewSub('')
            }}
          >
            Добавить
          </button>
        </div>
      </Section>

      {info.subgroups.length > 0 && (
        <Section title="Пары подгрупп" footer="Пара из расписания ГУУ, отмеченная подгруппой, видна только её студентам (если они выбрали подгруппу).">
          {info.tags.map((t) => (
            <div key={t.id} className="row">
              <span className="tag-text">
                {WEEKDAYS_SHORT[t.weekday]} {t.start} · {t.subject}
                {t.teacher ? ` · ${t.teacher}` : ''} → <b>{info.subgroups.find((s) => s.id === t.subgroup)?.name ?? '?'}</b>
              </span>
              <button type="button" className="button-inline danger" disabled={busy} onClick={() => run('/starosta/tag-delete', { id: t.id }, 'Убрано')}>
                ✕
              </button>
            </div>
          ))}
          <div className="row row-plain">
            <div className="form">
              <div className="row-chips">
                {WEEKDAYS_FULL.slice(0, 6).map((name, i) => (
                  <button key={name} type="button" className="chip" aria-pressed={tagDay === i} onClick={() => setTagDay(i)}>
                    {WEEKDAYS_SHORT[i]}
                  </button>
                ))}
              </div>
              {weekPairs.length === 0 && <span className="section-footer">В этот день пар нет</span>}
              {weekPairs.map((p) => (
                <div key={`${p.start}|${p.subject}|${p.teacher}`} className="tag-pick">
                  <span>
                    {p.start} · {p.subject}
                    {p.teacher ? ` · ${p.teacher}` : ''}
                  </span>
                  <div className="row-chips">
                    {info.subgroups.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="chip"
                        aria-pressed={info.tags.some(
                          (t) => t.weekday === tagDay && t.start === p.start && t.subject === p.subject && t.subgroup === s.id,
                        )}
                        disabled={busy}
                        onClick={() =>
                          run('/starosta/tag-add', { weekday: tagDay, start: p.start, subject: p.subject, teacher: p.teacher, subgroup: s.id }, 'Пара отмечена')
                        }
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
