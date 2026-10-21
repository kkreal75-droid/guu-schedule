import { useState, type ReactNode } from 'react'
import { HOLIDAYS, YEAR, summary, type Period, type PeriodKind } from '../../shared/calendar-core'
import { isEvenWeek } from '../../shared/format-core'
import { dayFromIso, isoFromDay } from '../../shared/schedule-core'
import { holidayTitle, isoLong, kindTitle, periodTitle, sourceTitle } from '../academic'
import { t, tn } from '../i18n'
import { ChevronRight } from '../icons'
import { getTimetable, moscowNow } from '../schedule'
import { haptic } from '../telegram'

// Учебный график — «обратный отсчёт» (этап 8.3, вариант A владельца): главное видно сразу — сколько дней до
// ближайшего события (сессия / каникулы / учёба), прогресс текущего периода и три строки «что дальше».
// Весь год — по кнопке. Цвета: учёба — синий, сессия — оранжевый, каникулы — зелёный, практика — фиолетовый.

// «Зимняя сессия» → «до зимней сессии»
function untilTitle(p: Period): string {
  if (p.kind === 'holidays') return t('до каникул')
  if (p.kind === 'study') return t('до начала учёбы')
  if (p.kind === 'practice') return t('до практики')
  const title = p.title.toLowerCase()
  if (title.includes('гиа')) return t('до ГИА') // i18n-ignore — название периода
  if (title.startsWith('зимн')) return t('до зимней сессии') // i18n-ignore
  if (title.startsWith('летн')) return t('до летней сессии') // i18n-ignore
  if (title.startsWith('весенн')) return t('до весенней сессии') // i18n-ignore
  return t('до сессии')
}

const daysText = (n: number) => tn(n, '{n} день|{n} дня|{n} дней')

// куда считаем: идёт учёба или практика — до сессии; сессия — до каникул; каникулы — до учёбы
function target(periods: Period[], current: Period | null, today: string): Period | null {
  const next = (kind: PeriodKind) => periods.find((p) => p.kind === kind && p.start > today) ?? null
  if (current?.kind === 'session') return next('holidays') ?? next('study')
  if (current?.kind === 'holidays') return next('study') ?? next('session')
  return next('session') ?? next('holidays')
}

const span = (p: Period) => `${isoLong(p.start)} — ${isoLong(p.end)}`

function Row({ kind, label, value }: { kind: PeriodKind | 'holiday'; label: string; value: string }) {
  return (
    <div className={`cd-row ck-${kind}`}>
      <span className="cal-dot" />
      <span className="cd-row-label">{label}</span>
      <span className="cd-row-value">{value}</span>
    </div>
  )
}

export function AcademicCalendar({ periods, typical, title }: { periods: Period[]; typical: boolean; title: ReactNode }) {
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
      ? isEvenWeek(week)
        ? t('{n}-я неделя, чётная · учёба до {date}', { n: week, date: isoLong(current.end) })
        : t('{n}-я неделя, нечётная · учёба до {date}', { n: week, date: isoLong(current.end) })
      : t('{what} до {date}', { what: kindTitle(current.kind), date: isoLong(current.end) })
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
          <span className="cd-hero-number">{days === 0 ? t('сегодня') : daysText(days)}</span>
          <span className="cd-hero-sub">{t('с {date}', { date: isoLong(goal.start) })}</span>
        </div>
      ) : current ? (
        // впереди в этом году ничего — летние каникулы: считаем до нового учебного года
        <div className={`cd-hero ck-${current.kind}`}>
          <span className="cd-hero-label">{t('до нового учебного года')}</span>
          <span className="cd-hero-number">{daysText(dayFromIso(current.end) + 1 - dayFromIso(today))}</span>
          <span className="cd-hero-sub">{t('с {date}', { date: isoLong(isoFromDay(dayFromIso(current.end) + 1)) })}</span>
        </div>
      ) : (
        <div className="cd-hero ck-none">
          <span className="cd-hero-number cd-hero-small">{t('Учебный год {year} окончен', { year: YEAR.title })}</span>
        </div>
      )}

      {current && progress !== null && (
        <div className={`cd-progress ck-${current.kind}`}>
          <div className="cd-progress-head">
            <span>{periodTitle(current)}</span>
            <span className="cd-progress-pct">{progress}%</span>
          </div>
          <div className="cd-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          {progressSub && <span className="cd-progress-sub">{progressSub}</span>}
        </div>
      )}

      <div className="cd-list">
        {session && <Row kind="session" label={periodTitle(session)} value={span(session)} />}
        {holidays && <Row kind="holidays" label={periodTitle(holidays)} value={span(holidays)} />}
        {holiday && <Row kind="holiday" label={holidayTitle(holiday.title)} value={isoLong(holiday.date)} />}
      </div>

      <button type="button" className="cd-more" aria-expanded={all} onClick={() => (haptic(), setAll((v) => !v))}>
        {all ? t('Свернуть') : t('Весь учебный год')}
        <ChevronRight className="cd-more-chevron" />
      </button>

      {all && (
        <div className="cd-all">
          <div className="cd-list">
            {periods.map((p) => (
              <Row key={p.start} kind={p.kind} label={periodTitle(p)} value={span(p)} />
            ))}
          </div>
          <div className="cd-list">
            <span className="cd-list-title">{t('Праздничные выходные')}</span>
            {HOLIDAYS.filter((h) => h.date >= YEAR.start && h.date <= YEAR.end).map((h) => (
              <Row key={h.date} kind="holiday" label={holidayTitle(h.title)} value={isoLong(h.date)} />
            ))}
          </div>
        </div>
      )}

      <p className="cal-note cd-source">
        {typical ? `${t('Типовой график 1 курса бакалавриата.')} ` : <>{title}. </>}
        {exact
          ? t('Даты {source}.', { source: sourceTitle('doc') })
          : t('Даты примерные — по расписанию и типовому графику ГУУ, уточняются.')}
      </p>
    </div>
  )
}
