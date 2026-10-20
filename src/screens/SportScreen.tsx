import { useCallback, useEffect, useMemo, useState } from 'react'
import { onWeek, sectionEmoji, sessionsInSemester, type SportData, type SportSection, type SportSession } from '../../shared/sport-core'
import { DayStrip } from '../components/DayStrip'
import { Segmented } from '../components/Segmented'
import { WeekCard } from '../components/WeekCard'
import { WEEKDAYS_FULL, WEEKDAYS_SHORT } from '../format'
import { ChevronLeft, ChevronRight, PersonIcon, PinIcon } from '../icons'
import { getTimetable, moscowNow } from '../schedule'
import { cachedSport, loadSport } from '../sport/api'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { initialCursor, type Cursor } from './ScheduleScreen'

// «Спорт» — физкультура: «По времени» (неделя, день, занятия по парам) и «По секциям» (список → секция).
// Данные — GET /sport, их ведёт владелец в админке («Спорт»): на guu.ru машиночитаемого расписания секций нет.

type Mode = 'time' | 'sections'
const MODES: { value: Mode; label: string }[] = [
  { value: 'time', label: 'По времени' },
  { value: 'sections', label: 'По секциям' },
]

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}
const short = (t: string) => t.replace(/^0(\d)/, '$1')
const weeksLabel = (spec: string) =>
  !spec ? '' : spec === 'even' ? 'чётные недели' : spec === 'odd' ? 'нечётные недели' : `недели ${spec}`

const PREVIEW = 4 // карточек в блоке до «Ещё N»

// место секции: своё, а если не задано — самое частое у её занятий
function placeOf(section: SportSection, sessions: SportSession[]): string | null {
  if (section.place) return section.place
  const count = new Map<string, number>()
  for (const s of sessions) if (s.section_id === section.id && s.place) count.set(s.place, (count.get(s.place) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const teacherOf = (section: SportSection, sessions: SportSession[]) =>
  section.teacher ?? sessions.find((s) => s.section_id === section.id && s.teacher)?.teacher ?? null

export function SportScreen() {
  const [data, setData] = useState<SportData | null>(cachedSport)
  const [error, setError] = useState(false)
  const [mode, setMode] = useState<Mode>('time')
  const [cursor, setCursor] = useState<Cursor>(() => initialCursor())
  const [open, setOpen] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSport().then(
      (d) => {
        setData(d)
        setError(false)
      },
      () => setError(true),
    )
  }, [])

  const close = useCallback(() => {
    setOpen(null)
    window.scrollTo(0, 0)
  }, [])
  useBackButton(open !== null ? close : null)

  const T = getTimetable()
  const now = moscowNow()
  const { week, weekday } = cursor
  const monday = T.dayOf(week, 0)
  const sections = useMemo(() => new Map((data?.sections ?? []).map((s) => [s.id, s])), [data])
  const sessions = data?.sessions ?? []

  const sessionsOn = (w: number, wd: number) =>
    T.inSemester(w) ? sessions.filter((s) => s.weekday === wd && onWeek(s.weeks, w) && sections.has(s.section_id)) : []

  const go = (next: Cursor) => {
    if (!T.inSemester(next.week)) return
    haptic()
    setCursor(next)
    setExpanded(new Set())
  }

  const section = open !== null ? sections.get(open) : null
  if (section) return <SectionPage section={section} sessions={sessions.filter((s) => s.section_id === section.id)} onBack={close} />

  const empty = !data?.sections.length
  return (
    <div className="screen sched">
      <header className="screen-head">
        <h1 className="screen-title">Физкультура</h1>
      </header>
      <div className="seg-wrap">
        <Segmented label="Как показать" value={mode} options={MODES} onChange={setMode} />
      </div>

      {empty ? (
        <div className="content">
          <div className="empty">
            <div className="empty-emoji">🏐</div>
            <div className="empty-title">Расписание секций скоро появится</div>
            <div className="empty-text">
              {error && !data ? 'Не получилось загрузить. Проверь интернет.' : 'Как только оно будет — секции и время занятий появятся здесь.'}
            </div>
          </div>
        </div>
      ) : mode === 'time' ? (
        <>
          <WeekCard
            week={week}
            day={T.dayOf(week, weekday)}
            monday={monday}
            prevDisabled={week <= 1}
            nextDisabled={week >= T.maxWeek}
            onPrev={() => go({ week: week - 1, weekday })}
            onNext={() => go({ week: week + 1, weekday })}
          />
          <DayStrip
            monday={monday}
            weekday={weekday}
            today={now.day}
            busy={WEEKDAYS_SHORT.map((_, i) => sessionsOn(week, i).length > 0)}
            onPick={(i) => go({ week, weekday: i })}
          />
          <div className="content">
            <TimeBlocks
              list={sessionsOn(week, weekday)}
              sections={sections}
              expanded={expanded}
              onExpand={(key) => (haptic(), setExpanded((s) => new Set(s).add(key)))}
              onOpen={(id) => (haptic(), setOpen(id), window.scrollTo(0, 0))}
            />
          </div>
        </>
      ) : (
        <div className="content">
          <div className="section-body sport-list">
            {data!.sections.map((s) => {
              const own = sessions.filter((x) => x.section_id === s.id)
              const count = sessionsInSemester(own, T.maxWeek)
              return (
                <button key={s.id} type="button" className="row row-btn sport-row" onClick={() => (haptic(), setOpen(s.id), window.scrollTo(0, 0))}>
                  <span className="sport-emoji">{sectionEmoji(s)}</span>
                  <span className="sport-row-text">
                    <span className="sport-name">{s.name}</span>
                    <span className="sport-sub">
                      {count ? plural(count, 'занятие', 'занятия', 'занятий') : 'нет занятий'}
                      {placeOf(s, sessions) ? ` · ${placeOf(s, sessions)}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="row-chevron" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// «По времени»: блоки по парам «09:00 — 10:30 · 12 секций», в блоке — карточки секций
function TimeBlocks({
  list, sections, expanded, onExpand, onOpen,
}: {
  list: SportSession[]
  sections: Map<number, SportSection>
  expanded: Set<string>
  onExpand: (key: string) => void
  onOpen: (id: number) => void
}) {
  if (!list.length) {
    return (
      <div className="empty">
        <div className="empty-emoji">🛋️</div>
        <div className="empty-title">В этот день секций нет</div>
      </div>
    )
  }
  const blocks = new Map<string, SportSession[]>()
  for (const s of list) blocks.set(`${s.start}|${s.end}`, [...(blocks.get(`${s.start}|${s.end}`) ?? []), s])
  return (
    <div className="day-list">
      {[...blocks.entries()].map(([key, items]) => {
        const [start, end] = key.split('|')
        const all = expanded.has(key)
        const shown = all ? items : items.slice(0, PREVIEW)
        return (
          <section key={key} className="sport-block">
            <div className="lesson-head">
              <span className="lesson-start">{short(start)}</span>
              <span className="lesson-end">— {short(end)}</span>
              <span className="sport-count">{plural(items.length, 'секция', 'секции', 'секций')}</span>
            </div>
            <div className="sport-grid">
              {shown.map((s) => {
                const sec = sections.get(s.section_id)!
                const teacher = s.teacher ?? sec.teacher
                const place = s.place ?? sec.place
                return (
                  <button key={s.id} type="button" className="sport-card" onClick={() => onOpen(sec.id)}>
                    <span className="sport-emoji">{sectionEmoji(sec)}</span>
                    <span className="sport-card-text">
                      <span className="sport-name">{sec.name}</span>
                      {teacher && (
                        <span className="sport-meta">
                          <PersonIcon /> {teacher}
                        </span>
                      )}
                      {place && (
                        <span className="sport-meta">
                          <PinIcon /> {place}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            {!all && items.length > PREVIEW && (
              <button type="button" className="sport-more" onClick={() => onExpand(key)}>
                Ещё {items.length - PREVIEW}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

// Экран секции: кто ведёт, где, когда (по дням недели)
function SectionPage({ section, sessions, onBack }: { section: SportSection; sessions: SportSession[]; onBack: () => void }) {
  const T = getTimetable()
  const count = sessionsInSemester(sessions, T.maxWeek)
  const teacher = teacherOf(section, sessions)
  const place = placeOf(section, sessions)
  const byDay = WEEKDAYS_FULL.map((name, i) => ({ name, items: sessions.filter((s) => s.weekday === i) })).filter((d) => d.items.length)
  return (
    <div className="screen more">
      <header className="page-head">
        <button type="button" className="page-back" onClick={onBack}>
          <ChevronLeft /> Физкультура
        </button>
      </header>
      <div className="sport-hero">
        <span className="sport-emoji sport-emoji-big">{sectionEmoji(section)}</span>
        <h2 className="sport-hero-name">{section.name}</h2>
        <p className="sport-hero-sub">{count ? `${plural(count, 'занятие', 'занятия', 'занятий')} за семестр` : 'Занятий пока нет'}</p>
      </div>
      {(teacher || place || section.about) && (
        <div className="section-body sport-info">
          {teacher && (
            <div className="row">
              <span>Преподаватель</span>
              <span className="row-value">{teacher}</span>
            </div>
          )}
          {place && (
            <div className="row">
              <span>Где</span>
              <span className="row-value">{place}</span>
            </div>
          )}
          {section.about && <p className="sport-about">{section.about}</p>}
        </div>
      )}
      {byDay.map((d) => (
        <section key={d.name} className="section">
          <h3 className="section-title">{d.name}</h3>
          <div className="section-body">
            {d.items.map((s) => (
              <div key={s.id} className="row sport-session">
                <span className="sport-session-time">
                  {short(s.start)}–{short(s.end)}
                </span>
                <span className="sport-session-text">
                  {[s.place && s.place !== place ? s.place : null, s.teacher && s.teacher !== teacher ? s.teacher : null, weeksLabel(s.weeks)]
                    .filter(Boolean)
                    .join(' · ') || 'каждую неделю'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
