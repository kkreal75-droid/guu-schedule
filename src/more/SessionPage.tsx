import { useEffect, useState } from 'react'
import { Row } from '../components/Row'
import { Section } from '../components/Section'
import type { Period } from '../../shared/calendar-core'
import { isoFromDay } from '../../shared/schedule-core'
import { groupCalendar, periodTitle, sourceTitle } from '../academic'
import { loadSession, loadSessionStatus, type SessionFile, type SessionItem } from '../data'
import { formatDate, formatDays, weekdayShort } from '../format'
import { dayFromIso, groupName, moscowNow } from '../schedule'
import { t } from '../i18n'
import { trKind, trSubject } from '../guu'

const SESSION_PAGE = 'https://guu.ru/student/session/'

const weekday = (day: number) => weekdayShort((((day - 4) % 7) + 7) % 7) // 1970-01-01 — четверг

// Экзамен или зачёт: слева дата и день недели, справа вид, время, предмет, аудитория и преподаватель
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
          {item.kind && <span className="badge">{trKind(item.kind)}</span>}
          {item.start && (
            <span className="session-time">
              {item.start}
              {item.end ? `–${item.end}` : ''}
            </span>
          )}
        </div>
        <div className="session-subject">{trSubject(item.subject)}</div>
        {(item.room || item.teacher) && <div className="session-meta">{[item.room, item.teacher].filter(Boolean).join(' · ')}</div>}
      </div>
    </div>
  )
}

// «По учебному графику» — сессии группы из учебного графика (src/academic.ts): название слева, даты справа
function SessionPlan({ periods }: { periods: Period[] }) {
  const today = isoFromDay(moscowNow().day)
  const sources = [...new Set(periods.map((p) => sourceTitle(p.source)))]
  return (
    <Section
      title={t('По учебному графику')}
      footer={`${t('Даты {source}.', { source: sources.join(', ') })} ${t('Источник: {url}', { url: SESSION_PAGE.replace(/^https:\/\//, '').replace(/\/$/, '') })}`}
    >
      {periods.map((p) => (
        <Row
          key={p.start}
          title={periodTitle(p)}
          value={formatDays(dayFromIso(p.start), dayFromIso(p.end))}
          className={p.start <= today && today <= p.end ? 'is-now' : undefined}
        />
      ))}
    </Section>
  )
}

// какую сессию ждём: осенний семестр (август–январь) — зимнюю, весенний — летнюю
const upcoming = (day: number) => {
  const month = new Date(day * 86_400_000).getUTCMonth() + 1
  return month >= 8 || month === 1
    ? t('Расписание зимней сессии ещё не опубликовано. Обычно ГУУ выкладывает его ближе к декабрю. Как только оно появится, я пришлю уведомление.')
    : t('Расписание летней сессии ещё не опубликовано. Обычно ГУУ выкладывает его ближе к маю. Как только оно появится, я пришлю уведомление.')
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

  if (state === 'loading') return <p className="lead">{t('Загружаю…')}</p>
  if (state === 'error') return <p className="lead">{t('Не получилось загрузить расписание сессии. Проверьте интернет.')}</p>
  if (!state.file) {
    const waiting = upcoming(moscowNow().day)
    return (
      <>
        <p className="callout session-wait">{waiting}</p>
        {plan && plan.length > 0 && <SessionPlan periods={plan} />}
        {page && page.includes('прошлого года') /* i18n-ignore — текст из session_status.json */ && (
          <p className="section-footer">
            {t('Сейчас на странице сессии guu.ru — прошлогодняя сессия. Её группы уже на следующем курсе, поэтому здесь она не показывается.')}
          </p>
        )}
      </>
    )
  }
  const today = moscowNow().day
  const items = state.file.items
  return (
    <>
      <p className="page-lead">
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
