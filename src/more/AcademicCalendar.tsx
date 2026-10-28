import { useState, type ReactNode } from 'react'
import { HOLIDAYS, YEAR, summary, type Period, type PeriodKind } from '../../shared/calendar-core'
import { isEvenWeek } from '../../shared/format-core'
import { dayFromIso, isoFromDay } from '../../shared/schedule-core'
import { holidayTitle, isoLong, periodTitle, sourceTitle } from '../academic'
import { Row } from '../components/Row'
import { formatDays } from '../format'
import { t, tn } from '../i18n'
import { getTimetable, moscowNow } from '../schedule'
import { haptic } from '../telegram'

// Учебный график — «обратный отсчёт» (этап 8.3): крупная цифра тёмного акцента — сколько дней до ближайшего события
// (сессия / каникулы / учёба), прогресс текущего периода, ближайшие даты по порядку. Весь год — по строке.

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

// «она начнётся 9 января» / «они начнутся 30 января»
const startsText = (p: Period, date: string) =>
  p.kind === 'holidays' ? t('они начнутся {date}', { date }) : t('она начнётся {date}', { date })

// куда считаем: идёт учёба или практика — до сессии; сессия — до каникул; каникулы — до учёбы
function target(periods: Period[], current: Period | null, today: string): Period | null {
  const next = (kind: PeriodKind) => periods.find((p) => p.kind === kind && p.start > today) ?? null
  if (current?.kind === 'session') return next('holidays') ?? next('study')
  if (current?.kind === 'holidays') return next('study') ?? next('session')
  return next('session') ?? next('holidays')
}

const span = (p: Period) => formatDays(dayFromIso(p.start), dayFromIso(p.end))

// Крупная цифра и подпись: «78 / дней до зимней сессии / она начнётся 9 января»
function Countdown({ days, label, sub }: { days: number; label: string; sub: string }) {
  return (
    <div className="cd-hero">
      <span className="cd-number">{days}</span>
      <span className="cd-label">
        {tn(days, 'день|дня|дней')} {label}
        <br />
        <span className="cd-sub">{sub}</span>
      </span>
    </div>
  )
}

export function AcademicCalendar({
  periods,
  typical,
  title,
  onWeeks,
}: {
  periods: Period[]
  typical: boolean
  title: ReactNode
  onWeeks?: () => void // «Недели семестра и графики (PDF)»
}) {
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
        ? t('{n} неделя, чётная. Учёба до {date}', { n: week, date: isoLong(current.end) })
        : t('{n} неделя, нечётная. Учёба до {date}', { n: week, date: isoLong(current.end) })
      : t('До {date}', { date: isoLong(current.end) })
    : null

  // ближайшее по порядку: сессия, каникулы, праздник
  const session = current?.kind === 'session' ? current : (s.nextSession?.period ?? null)
  const holidays = current?.kind === 'holidays' ? current : (s.nextHolidays?.period ?? null)
  const holiday = HOLIDAYS.find((h) => h.date >= today) ?? null
  const upcoming = [
    session && { key: 's', start: session.start, title: periodTitle(session), value: span(session) },
    holidays && { key: 'h', start: holidays.start, title: periodTitle(holidays), value: span(holidays) },
    holiday && { key: 'd', start: holiday.date, title: holidayTitle(holiday.title), value: isoLong(holiday.date) },
  ]
    .filter((x): x is { key: string; start: string; title: string; value: string } => Boolean(x))
    .sort((a, b) => a.start.localeCompare(b.start))
  const exact = periods.every((p) => p.source === 'doc')

  return (
    <div className="cd">
      {goal && days !== null ? (
        days === 0 ? (
          <p className="cd-today">{t('{what} начинается сегодня', { what: periodTitle(goal) })}</p>
        ) : (
          <Countdown days={days} label={untilTitle(goal)} sub={startsText(goal, isoLong(goal.start))} />
        )
      ) : current ? (
        // впереди в этом году ничего — летние каникулы: считаем до нового учебного года
        <Countdown
          days={dayFromIso(current.end) + 1 - dayFromIso(today)}
          label={t('до нового учебного года')}
          sub={t('он начнётся {date}', { date: isoLong(isoFromDay(dayFromIso(current.end) + 1)) })}
        />
      ) : (
        <p className="cd-today">{t('Учебный год {year} окончен', { year: YEAR.title })}</p>
      )}

      {current && progress !== null && (
        <section className="section cd-progress">
          <h3 className="section-title">
            {periodTitle(current)} · {progress}%
          </h3>
          <div className="progress cd-bar" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          {progressSub && <p className="cd-progress-sub">{progressSub}</p>}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="section">
          <h3 className="section-title">{t('Ближайшее')}</h3>
          <div className="list">
            {upcoming.map((x) => (
              <Row key={x.key} title={x.title} value={x.value} />
            ))}
          </div>
        </section>
      )}

      <div className="list cd-links">
        <Row title={all ? t('Свернуть') : t('Весь учебный год')} chevron onClick={() => (haptic(), setAll((v) => !v))} />
        {onWeeks && <Row title={t('Недели семестра и графики (PDF)')} chevron onClick={() => (haptic(), onWeeks())} />}
      </div>

      {all && (
        <>
          <section className="section">
            <h3 className="section-title">{t('Весь учебный год')}</h3>
            <div className="list">
              {periods.map((p) => (
                <Row key={p.start} title={periodTitle(p)} value={span(p)} className={p.start <= today && today <= p.end ? 'is-now' : undefined} />
              ))}
            </div>
          </section>
          <section className="section">
            <h3 className="section-title">{t('Праздничные выходные')}</h3>
            <div className="list">
              {HOLIDAYS.filter((h) => h.date >= YEAR.start && h.date <= YEAR.end).map((h) => (
                <Row key={h.date} title={holidayTitle(h.title)} value={isoLong(h.date)} />
              ))}
            </div>
          </section>
        </>
      )}

      <p className="section-footer cd-source">
        {typical ? `${t('Типовой график 1 курса бакалавриата.')} ` : <>{title}. </>}
        {exact ? t('Даты {source}.', { source: sourceTitle('doc') }) : t('Даты примерные — по расписанию и типовому графику ГУУ, уточняются.')}
      </p>
    </div>
  )
}
