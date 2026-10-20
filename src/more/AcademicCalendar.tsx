import { useMemo, useState } from 'react'
import {
  HOLIDAYS, KIND_TITLES, SOURCE_TITLES, YEAR, dayInfo, daysWord, formatIsoLong, summary, type DayInfo, type Period,
  type PeriodKind,
} from '../../shared/calendar-core'
import { isEvenWeek } from '../../shared/format-core'
import { dayFromIso, isoFromDay } from '../../shared/schedule-core'
import { WEEKDAYS_FULL, WEEKDAYS_SHORT } from '../format'
import { CloseIcon } from '../icons'
import { getTimetable, moscowNow } from '../schedule'
import { haptic } from '../telegram'

// Учебный год визуально (этап 8.3): «Сейчас: учёба, 8-я неделя · до сессии N дней · до каникул M дней»,
// полоса сентябрь → август, сетка месяцев по дням (нажатие — что в этот день), легенда. Цвета: учёба — синий,
// сессия — оранжевый, каникулы — зелёный, практика — фиолетовый, праздники — серый.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTH_LETTERS = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д']

const yearStart = dayFromIso(YEAR.start)
const yearDays = dayFromIso(YEAR.end) - yearStart + 1
const pct = (iso: string) => ((dayFromIso(iso) - yearStart) / yearDays) * 100

// месяцы учебного года: [год, месяц 0–11]
const yearMonths: [number, number][] = Array.from({ length: 12 }, (_, i) => {
  const m = (8 + i) % 12
  return [m >= 8 ? 2026 : 2027, m]
})

const LEGEND: { kind: PeriodKind | 'holiday'; title: string }[] = [
  { kind: 'study', title: 'Учёба' },
  { kind: 'session', title: 'Сессия' },
  { kind: 'holidays', title: 'Каникулы' },
  { kind: 'practice', title: 'Практика' },
  { kind: 'holiday', title: 'Праздник' },
]

function NowCard({ periods, today }: { periods: Period[]; today: string }) {
  const s = summary(periods, today)
  const T = getTimetable()
  const week = T.weekOf(dayFromIso(today))
  const current = s.current
  const head = !current
    ? 'Вне учебного графика'
    : current.kind === 'study'
      ? `Учёба${T.inSemester(week) && today < '2027-01-01' ? `, ${week}-я неделя · ${isEvenWeek(week) ? 'чётная' : 'нечётная'}` : ''}`
      : `${current.title} · до ${formatIsoLong(current.end)}`
  const counters = [
    s.nextSession && current?.kind !== 'session' ? `до сессии ${s.nextSession.days} ${daysWord(s.nextSession.days)}` : null,
    s.nextHolidays && current?.kind !== 'holidays' ? `до каникул ${s.nextHolidays.days} ${daysWord(s.nextHolidays.days)}` : null,
  ].filter(Boolean)
  return (
    <div className={`cal-now ck-${current?.kind ?? 'none'}`}>
      <span className="cal-now-label">Сейчас</span>
      <span className="cal-now-head">{head}</span>
      {counters.length > 0 && <span className="cal-now-sub">{counters.join(' · ')}</span>}
    </div>
  )
}

function YearBar({ periods, today }: { periods: Period[]; today: string }) {
  return (
    <div className="cal-bar-wrap" aria-hidden="true">
      <div className="cal-bar">
        {periods.map((p, i) => (
          <span
            key={i}
            className={`cal-seg ck-${p.kind}`}
            style={{ left: `${pct(p.start)}%`, width: `${pct(isoFromDay(dayFromIso(p.end) + 1)) - pct(p.start)}%` }}
          />
        ))}
        {today >= YEAR.start && today <= YEAR.end && <span className="cal-today-mark" style={{ left: `${pct(today)}%` }} />}
      </div>
      <div className="cal-bar-months">
        {yearMonths.map(([y, m]) => {
          const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
          const width = (days / yearDays) * 100
          return (
            <span key={`${y}-${m}`} style={{ width: `${width}%` }}>
              {MONTH_LETTERS[m]}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Month({ year, month, periods, today, selected, onPick }: {
  year: number
  month: number
  periods: Period[]
  today: string
  selected: string | null
  onPick: (info: DayInfo) => void
}) {
  const first = Date.UTC(year, month, 1) / 86_400_000
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = (((first - 4) % 7) + 7) % 7 // 1970-01-01 — четверг; 0 — понедельник
  return (
    <section className="cal-month">
      <h4 className="cal-month-title">
        {MONTHS[month]} {year}
      </h4>
      <div className="cal-grid">
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w} className="cal-wd">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = isoFromDay(first + i)
          const info = dayInfo(periods, iso)
          const kind = info.holiday ? 'holiday' : (info.period?.kind ?? 'none')
          return (
            <button
              key={iso}
              type="button"
              className={`cal-day ck-${kind}${info.sunday && !info.holiday ? ' is-sunday' : ''}`}
              data-today={iso === today || undefined}
              data-selected={iso === selected || undefined}
              onClick={() => (haptic(), onPick(info))}
              aria-label={`${i + 1} ${MONTHS[month].toLowerCase()}`}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function DayCard({ info, onClose }: { info: DayInfo; onClose: () => void }) {
  const wd = WEEKDAYS_FULL[(((dayFromIso(info.iso) - 4) % 7) + 7) % 7]
  const p = info.period
  return (
    <div className="cal-daycard" role="status">
      <div className="cal-daycard-text">
        <span className="cal-daycard-date">
          {wd}, {formatIsoLong(info.iso)}
        </span>
        {info.holiday && <span className="cal-daycard-line ck-holiday">🎈 {info.holiday.title} — выходной</span>}
        {p ? (
          <span className={`cal-daycard-line ck-${p.kind}`}>
            {KIND_TITLES[p.kind]}
            {p.title && p.title !== KIND_TITLES[p.kind] ? ` · ${p.title}` : ''} ({formatIsoLong(p.start)} — {formatIsoLong(p.end)})
          </span>
        ) : (
          !info.holiday && <span className="cal-daycard-line">Вне учебного графика</span>
        )}
        {p && <span className="cal-daycard-source">{SOURCE_TITLES[p.source]}</span>}
        {info.sunday && !info.holiday && p?.kind === 'study' && <span className="cal-daycard-source">Воскресенье — пар нет</span>}
      </div>
      <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  )
}

export function AcademicCalendar({ periods, typical, title }: { periods: Period[]; typical: boolean; title: string }) {
  const today = isoFromDay(moscowNow().day)
  const [selected, setSelected] = useState<DayInfo | null>(null)
  const sources = useMemo(() => [...new Set(periods.map((p) => p.source))], [periods])
  const holidays = HOLIDAYS.filter((h) => h.date >= YEAR.start && h.date <= YEAR.end)

  return (
    <div className="cal">
      <NowCard periods={periods} today={today} />

      <div className="cal-card">
        <div className="cal-card-head">
          <span className="cal-card-title">Учебный год {YEAR.title}</span>
          <span className="cal-card-sub">{title}</span>
        </div>
        <YearBar periods={periods} today={today} />
        <div className="cal-legend">
          {LEGEND.map((l) => (
            <span key={l.kind} className={`cal-legend-item ck-${l.kind}`}>
              <span className="cal-dot" />
              {l.title}
            </span>
          ))}
        </div>
        {typical && <p className="cal-note">Типовой график 1 курса бакалавриата — у преподавателя своей группы нет.</p>}
      </div>

      <div className="cal-card cal-periods">
        {periods.map((p, i) => (
          <div key={i} className={`cal-period ck-${p.kind}`} data-now={(p.start <= today && today <= p.end) || undefined}>
            <span className="cal-dot" />
            <span className="cal-period-text">
              <span className="cal-period-title">{p.title || KIND_TITLES[p.kind]}</span>
              <span className="cal-period-dates">
                {formatIsoLong(p.start)} — {formatIsoLong(p.end)}
                <span className="cal-period-source"> · {SOURCE_TITLES[p.source]}</span>
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="cal-months">
        {yearMonths.map(([y, m]) => (
          <Month
            key={`${y}-${m}`}
            year={y}
            month={m}
            periods={periods}
            today={today}
            selected={selected?.iso ?? null}
            onPick={setSelected}
          />
        ))}
      </div>

      <div className="cal-card">
        <div className="cal-card-head">
          <span className="cal-card-title">Праздничные нерабочие дни</span>
        </div>
        {holidays.map((h) => (
          <div key={h.date} className="cal-holiday-row">
            <span className="cal-dot ck-holiday" />
            <span className="cal-holiday-date">{formatIsoLong(h.date)}</span>
            <span className="cal-holiday-title">{h.title}</span>
          </div>
        ))}
        <p className="cal-note">ТК РФ, постановления Правительства № 1466 (2025) и № 1187 (2026) о переносе выходных.</p>
      </div>

      <p className="cal-note cal-sources">
        Откуда даты: {sources.map((s) => SOURCE_TITLES[s]).join('; ')}. «Уточняется» — до проверки по документу ГУУ;
        официальный график программы (PDF) — ниже.
      </p>

      {selected && <DayCard info={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
