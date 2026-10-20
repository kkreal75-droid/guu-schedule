import { useState } from 'react'
import {
  HOLIDAYS, KIND_TITLES, SOURCE_TITLES, YEAR, daysWord, formatIsoLong, summary, type Period, type PeriodKind,
} from '../../shared/calendar-core'
import { isEvenWeek } from '../../shared/format-core'
import { dayFromIso, isoFromDay } from '../../shared/schedule-core'
import { ChevronRight } from '../icons'
import { getTimetable, moscowNow } from '../schedule'
import { haptic } from '../telegram'

// Учебный график — «обратный отсчёт» (этап 8.3, вариант A владельца): главное видно сразу — сколько дней до
// ближайшего события (сессия / каникулы / учёба), прогресс текущего периода и три строки «что дальше».
// Весь год — по кнопке. Цвета: учёба — синий, сессия — оранжевый, каникулы — зелёный, практика — фиолетовый.

// «Зимняя сессия» → «до зимней сессии»
function untilTitle(p: Period): string {
  if (p.kind === 'holidays') return 'до каникул'
  if (p.kind === 'study') return 'до начала учёбы'
  if (p.kind === 'practice') return 'до практики'
  const t = p.title.toLowerCase()
  if (t.includes('гиа')) return 'до ГИА'
  const season = ['зимн', 'летн', 'весенн'].find((s) => t.startsWith(s))
  return season ? `до ${season}ей сессии` : 'до сессии'
}

// куда считаем: идёт учёба или практика — до сессии; сессия — до каникул; каникулы — до учёбы
function target(periods: Period[], current: Period | null, today: string): Period | null {
  const next = (kind: PeriodKind) => periods.find((p) => p.kind === kind && p.start > today) ?? null
  if (current?.kind === 'session') return next('holidays') ?? next('study')
  if (current?.kind === 'holidays') return next('study') ?? next('session')
  return next('session') ?? next('holidays')
}

const span = (p: Period) => `${formatIsoLong(p.start)} — ${formatIsoLong(p.end)}`

function Row({ kind, label, value }: { kind: PeriodKind | 'holiday'; label: string; value: string }) {
  return (
    <div className={`cd-row ck-${kind}`}>
      <span className="cal-dot" />
      <span className="cd-row-label">{label}</span>
      <span className="cd-row-value">{value}</span>
    </div>
  )
}

export function AcademicCalendar({ periods, typical, title }: { periods: Period[]; typical: boolean; title: string }) {
  const today = isoFromDay(moscowNow().day)
  const [all, setAll] = useState(false)
  const s = summary(periods, today)
  const current = s.current
  const goal = target(periods, current, today)
  const days = goal ? dayFromIso(goal.start) - dayFromIso(today) : null

  // прогресс текущего периода
  const T = getTimetable()
  const week = T.weekOf(dayFromIso(today))
  const progress = current
    ? Math.round(((dayFromIso(today) - dayFromIso(current.start) + 1) / (dayFromIso(current.end) - dayFromIso(current.start) + 1)) * 100)
    : null
  const progressSub = current
    ? current.kind === 'study' && T.inSemester(week) && today < '2027-01-01'
      ? `${week}-я неделя, ${isEvenWeek(week) ? 'чётная' : 'нечётная'} · учёба до ${formatIsoLong(current.end)}`
      : `${KIND_TITLES[current.kind]} до ${formatIsoLong(current.end)}`
    : null

  // «что дальше»: сессия, каникулы, ближайший праздник
  const session = current?.kind === 'session' ? current : (s.nextSession?.period ?? null)
  const holidays = current?.kind === 'holidays' ? current : (s.nextHolidays?.period ?? null)
  const holiday = HOLIDAYS.find((h) => h.date >= today) ?? null
  const exact = periods.every((p) => p.source === 'doc')

  return (
    <div className="cd">
      {goal && days !== null ? (
        <div className={`cd-hero ck-${goal.kind}`}>
          <span className="cd-hero-label">{untilTitle(goal)}</span>
          <span className="cd-hero-number">{days === 0 ? 'сегодня' : `${days} ${daysWord(days)}`}</span>
          <span className="cd-hero-sub">с {formatIsoLong(goal.start)}</span>
        </div>
      ) : current ? (
        // впереди в этом году ничего — летние каникулы: считаем до нового учебного года
        <div className={`cd-hero ck-${current.kind}`}>
          <span className="cd-hero-label">до нового учебного года</span>
          <span className="cd-hero-number">
            {dayFromIso(current.end) + 1 - dayFromIso(today)} {daysWord(dayFromIso(current.end) + 1 - dayFromIso(today))}
          </span>
          <span className="cd-hero-sub">с {formatIsoLong(isoFromDay(dayFromIso(current.end) + 1))}</span>
        </div>
      ) : (
        <div className="cd-hero ck-none">
          <span className="cd-hero-number cd-hero-small">Учебный год {YEAR.title} окончен</span>
        </div>
      )}

      {current && progress !== null && (
        <div className={`cd-progress ck-${current.kind}`}>
          <div className="cd-progress-head">
            <span>{current.title || KIND_TITLES[current.kind]}</span>
            <span className="cd-progress-pct">{progress}%</span>
          </div>
          <div className="cd-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          {progressSub && <span className="cd-progress-sub">{progressSub}</span>}
        </div>
      )}

      <div className="cd-list">
        {session && <Row kind="session" label={session.title || 'Сессия'} value={span(session)} />}
        {holidays && <Row kind="holidays" label={holidays.title || 'Каникулы'} value={span(holidays)} />}
        {holiday && <Row kind="holiday" label={holiday.title} value={formatIsoLong(holiday.date)} />}
      </div>

      <button type="button" className="cd-more" aria-expanded={all} onClick={() => (haptic(), setAll((v) => !v))}>
        {all ? 'Свернуть' : 'Весь учебный год'}
        <ChevronRight className="cd-more-chevron" />
      </button>

      {all && (
        <div className="cd-all">
          <div className="cd-list">
            {periods.map((p) => (
              <Row key={p.start} kind={p.kind} label={p.title || KIND_TITLES[p.kind]} value={span(p)} />
            ))}
          </div>
          <div className="cd-list">
            <span className="cd-list-title">Праздничные выходные</span>
            {HOLIDAYS.filter((h) => h.date >= YEAR.start && h.date <= YEAR.end).map((h) => (
              <Row key={h.date} kind="holiday" label={h.title} value={formatIsoLong(h.date)} />
            ))}
          </div>
        </div>
      )}

      <p className="cal-note cd-source">
        {typical ? 'Типовой график 1 курса бакалавриата. ' : `${title}. `}
        {exact ? `Даты ${SOURCE_TITLES.doc}.` : 'Даты примерные — по расписанию и типовому графику ГУУ, уточняются.'}
      </p>
    </div>
  )
}
