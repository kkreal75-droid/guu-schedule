import { useEffect, useMemo, useState } from 'react'
import { groupCalendar, type GroupCalendar } from '../academic'
import type { GroupInfo, Level } from '../../shared/groups'
import { isEvenWeek } from '../../shared/format-core'
import { Section } from '../components/Section'
import { groupInfo } from '../data'
import { formatShortRange } from '../format'
import { ChevronRight, ExternalIcon } from '../icons'
import { dataUrl, getTimetable, moscowNow } from '../schedule'
import { openLink } from '../telegram'
import { AcademicCalendar } from './AcademicCalendar'
import { t, tKnown } from '../i18n'
import { levelTitle } from '../onboarding/Onboarding'
import { trProgram } from '../guu'

// «Другое → Календарный учебный график»: учебный год визуально (AcademicCalendar — учёба, сессии, каникулы,
// практика, праздники; данные — src/academic.ts), недели семестра по расписанию ГУУ и официальные графики
// программ — PDF со страницы «Сведения → Образование» (kug.json, собирает update.py)

type Kug = { level: Level | null; code: string | null; title: string; form: string | null; url: string }

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/ё/g, 'е') // i18n-ignore — сравнение названий
      .replace(/[^a-zа-я0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )

// похожесть названий программ (доля общих слов)
function similarity(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / Math.max(x.size, y.size)
}

export function KugPage({ group }: { group: string }) {
  const T = getTimetable()
  const now = moscowNow()
  const current = T.weekOf(now.day)
  const [all, setAll] = useState(false)
  const [kug, setKug] = useState<Kug[] | null>(null)
  const [error, setError] = useState(false)
  const [mine, setMine] = useState<GroupInfo | null>(null)
  const [query, setQuery] = useState('')
  const [calendar, setCalendar] = useState<GroupCalendar | null>(null)

  useEffect(() => {
    groupCalendar(group).then(setCalendar, () => setCalendar(null))
    fetch(dataUrl('kug.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ programs: Kug[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setKug(d.programs), () => setError(true))
    if (!group.startsWith('t-')) groupInfo(group).then(setMine, () => {})
  }, [group])

  // своя программа — по уровню и похожести названия (на сайте ГУУ названия бывают чуть другие)
  const best = useMemo(() => {
    if (!kug || !mine) return null
    const scored = kug
      .filter((k) => !k.level || k.level === mine.level)
      .map((k) => ({ k, score: Math.max(similarity(k.title, mine.program), similarity(k.title, mine.direction) * 0.8) }))
      .sort((a, b) => b.score - a.score)
    return scored[0] && scored[0].score >= 0.6 ? scored[0].k : null
  }, [kug, mine])

  const shown = useMemo(() => {
    if (!kug) return []
    const q = query.trim().toLowerCase()
    return kug
      .filter((k) => !q || k.title.toLowerCase().includes(q) || (k.code ?? '').includes(q))
      .sort((a, b) => (a.level ?? '').localeCompare(b.level ?? '') || a.title.localeCompare(b.title, 'ru'))
  }, [kug, query])

  const weeks = Array.from({ length: T.maxWeek }, (_, i) => i + 1)
  const firstMonday = T.dayOf(1, 0)
  const lastSunday = T.dayOf(T.maxWeek, 6)
  const visibleWeeks = all ? weeks : weeks.filter((w) => Math.abs(w - current) <= 2 || (current < 1 && w <= 3))

  return (
    <>
      {calendar ? (
        <AcademicCalendar
          periods={calendar.periods}
          typical={calendar.typical}
          title={
            calendar.info ? (
              <>
                <span lang="ru">{calendar.info.name}</span> · {t('{n} курс', { n: calendar.info.course })}
              </>
            ) : (
              t('типовой график')
            )
          }
        />
      ) : (
        <p className="lead">{t('Загружаю график…')}</p>
      )}

      <details className="cd-details">
        <summary>{t('Недели семестра и официальные графики (PDF)')}</summary>
        <Section
          title={t('Семестр по расписанию ГУУ')}
          footer={t('Номера недель и чётность — как в файлах расписания. Сессия и каникулы — в графике своей программы ниже.')}
        >
          <div className="row">
            <span>{t('Занятия')}</span>
            <span className="row-value">{formatShortRange(firstMonday, lastSunday)}</span>
          </div>
          <div className="row">
            <span>{t('Недель')}</span>
            <span className="row-value">{T.maxWeek}</span>
          </div>
          <div className="row">
            <span>{t('Сейчас')}</span>
            <span className="row-value">
              {T.inSemester(current)
                ? isEvenWeek(current)
                  ? t('{n}-я неделя, чётная', { n: current })
                  : t('{n}-я неделя, нечётная', { n: current })
                : current < 1
                  ? t('семестр не начался')
                  : t('семестр окончен')}
            </span>
          </div>
        </Section>

        <Section title={t('Недели')}>
          {visibleWeeks.map((w) => (
            <div key={w} className="row kug-week" data-current={w === current || undefined}>
              <span className="kug-week-no">{w}</span>
              <span className="kug-week-dates">{formatShortRange(T.dayOf(w, 0), T.dayOf(w, 6))}</span>
              <span className="row-value">{isEvenWeek(w) ? t('чётная') : t('нечётная')}</span>
            </div>
          ))}
          {!all && (
            <button type="button" className="row row-btn row-link" onClick={() => setAll(true)}>
              <span>{t('Все {n} недель', { n: T.maxWeek })}</span>
            </button>
          )}
        </Section>

        {best && (
          <Section title={t('Твоя программа')} footer={t('Официальный документ с сайта ГУУ: даты сессий, практик и каникул.')}>
            <button type="button" className="row row-btn kug-row" onClick={() => openLink(best.url)}>
              <span className="kug-row-text">
                <span className="kug-title" lang={trProgram(best.title) === best.title ? 'ru' : undefined}>{trProgram(best.title)}</span>
                <span className="kug-sub">
                  {[best.code, best.level ? levelTitle(best.level) : null, best.form && (tKnown(best.form) ?? best.form)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <ExternalIcon className="row-check" />
            </button>
          </Section>
        )}

        <Section title={t('Графики всех программ (PDF)')} footer={t('Источник: guu.ru → Сведения об образовательной организации → Образование.')}>
          <div className="row row-form">
            <input className="input" type="search" placeholder={t('Название или код программы')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {error && <div className="row row-text">{t('Не получилось загрузить список. Проверь интернет.')}</div>}
          {!kug && !error && <div className="row row-text">{t('Загружаю…')}</div>}
          {shown.slice(0, 80).map((k) => (
            <button key={k.url + k.title} type="button" className="row row-btn kug-row" onClick={() => openLink(k.url)}>
              <span className="kug-row-text">
                <span className="kug-title" lang={trProgram(k.title) === k.title ? 'ru' : undefined}>{trProgram(k.title)}</span>
                <span className="kug-sub">{[k.code, k.level ? levelTitle(k.level) : null, k.form && (tKnown(k.form) ?? k.form)].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight className="row-chevron" />
            </button>
          ))}
        </Section>
      </details>
    </>
  )
}
