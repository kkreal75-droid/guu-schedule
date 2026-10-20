import { useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { KIND_TITLES, SOURCE_TITLES, formatIsoLong, type Period } from '../../shared/calendar-core'
import { isoFromDay } from '../../shared/schedule-core'
import { groupCalendar } from '../academic'
import { loadSession, loadSessionStatus, type SessionFile, type SessionItem } from '../data'
import { WEEKDAYS_SHORT, formatDate } from '../format'
import { dayFromIso, groupName, moscowNow } from '../schedule'

const SESSION_PAGE = 'https://guu.ru/student/session/'

const weekday = (day: number) => WEEKDAYS_SHORT[(((day - 4) % 7) + 7) % 7] // 1970-01-01 — четверг

function Item({ item, past }: { item: SessionItem; past: boolean }) {
  const day = dayFromIso(item.date)
  const until = item.until ? dayFromIso(item.until) : null
  return (
    <div className={`row session-row${past ? ' is-past' : ''}`}>
      <div className="session-date">
        <span className="session-day">{formatDate(day)}</span>
        <span className="session-wd">
          {weekday(day)}
          {until ? ` — ${formatDate(until)}` : ''}
        </span>
      </div>
      <div className="session-body">
        <div className="session-top">
          {item.kind && <span className="badge">{item.kind}</span>}
          {item.start && (
            <span className="session-time">
              {item.start}
              {item.end ? `–${item.end}` : ''}
            </span>
          )}
        </div>
        <div className="session-subject">{item.subject}</div>
        {(item.room || item.teacher) && (
          <div className="session-meta">{[item.room, item.teacher].filter(Boolean).join(' · ')}</div>
        )}
      </div>
    </div>
  )
}

// «Когда сессия по учебному графику» — сессии группы из учебного графика (src/academic.ts)
function SessionPlan({ periods }: { periods: Period[] }) {
  const today = isoFromDay(moscowNow().day)
  return (
    <Section title="Когда сессия по учебному графику" footer="Весь учебный год — «Другое → Календарный учебный график».">
      <div className="session-plan">
        {periods.map((p) => (
          <div key={p.start} className="cal-period ck-session" data-now={(p.start <= today && today <= p.end) || undefined}>
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
    </Section>
  )
}

// какую сессию ждём: осенний семестр (август–январь) — зимнюю, весенний — летнюю
const upcoming = (day: number) => {
  const month = new Date(day * 86_400_000).getUTCMonth() + 1
  return month >= 8 || month === 1 ? { name: 'зимней', when: 'ближе к декабрю' } : { name: 'летней', when: 'ближе к маю' }
}

// Сессия своей группы — из data/session/<id>.json: update.py кладёт только текущий учебный год (даты не раньше
// начала семестра). Прошлогодние файлы guu.ru — архив другого потока, группам не показываются.
export function SessionPage({ group }: { group: string }) {
  const [state, setState] = useState<{ file: SessionFile | null } | 'loading' | 'error'>('loading')
  const [page, setPage] = useState<string | null>(null)
  const [plan, setPlan] = useState<Period[] | null>(null)
  useEffect(() => {
    let alive = true
    groupCalendar(group).then((c) => alive && setPlan(c.periods.filter((p) => p.kind === 'session')), () => {})
    loadSession(group).then(
      (file) => alive && setState({ file }),
      () => alive && setState('error'),
    )
    loadSessionStatus().then((s) => alive && setPage(s.page), () => {})
    return () => {
      alive = false
    }
  }, [group])

  if (state === 'loading') return <p className="lead">Загружаю…</p>
  if (state === 'error') return <p className="lead">Не получилось загрузить расписание сессии. Проверьте интернет.</p>
  if (!state.file) {
    const next = upcoming(moscowNow().day)
    return (
      <>
        <div className="session-wait">
          <span className="session-wait-emoji" aria-hidden>
            📚
          </span>
          <p className="lead">
            Расписание {next.name} сессии ещё не опубликовано. Обычно ГУУ выкладывает его {next.when} — как только появится,
            оно будет здесь, а я пришлю уведомление.
          </p>
        </div>
        {plan && plan.length > 0 && <SessionPlan periods={plan} />}
        {page && page.includes('прошлого года') && (
          <p className="section-footer">
            Сейчас на странице сессии guu.ru — {page}. Её группы уже на следующем курсе, поэтому здесь она не показывается.
          </p>
        )}
        <p className="section-footer">Источник: {SESSION_PAGE}</p>
      </>
    )
  }
  const today = moscowNow().day
  const items = state.file.items
  return (
    <>
      <p className="lead">
        {state.file.title} · {groupName(group)}
      </p>
      <Section>
        {items.map((item, i) => (
          <Item key={i} item={item} past={dayFromIso(item.until ?? item.date) < today} />
        ))}
      </Section>
    </>
  )
}
