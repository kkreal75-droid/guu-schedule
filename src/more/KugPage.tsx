import { useEffect, useMemo, useState } from 'react'
import { groupCalendar, type GroupCalendar } from '../academic'
import { LEVEL_TITLES, type GroupInfo, type Level } from '../../shared/groups'
import { isEvenWeek } from '../../shared/format-core'
import { Section } from '../components/Section'
import { groupInfo } from '../data'
import { formatShortRange } from '../format'
import { ChevronRight, ExternalIcon } from '../icons'
import { dataUrl, getTimetable, moscowNow } from '../schedule'
import { openLink } from '../telegram'
import { AcademicCalendar } from './AcademicCalendar'

// «Другое → Календарный учебный график»: учебный год визуально (AcademicCalendar — учёба, сессии, каникулы,
// практика, праздники; данные — src/academic.ts), недели семестра по расписанию ГУУ и официальные графики
// программ — PDF со страницы «Сведения → Образование» (kug.json, собирает update.py)

type Kug = { level: Level | null; code: string | null; title: string; form: string | null; url: string }

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
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
          title={calendar.info ? `${calendar.info.name} · ${calendar.info.course} курс` : 'типовой график'}
        />
      ) : (
        <p className="lead">Загружаю график…</p>
      )}

      <details className="cd-details">
        <summary>Недели семестра и официальные графики (PDF)</summary>
        <Section
          title="Семестр по расписанию ГУУ"
          footer="Номера недель и чётность — как в файлах расписания. Сессия и каникулы — в графике своей программы ниже."
        >
          <div className="row">
            <span>Занятия</span>
            <span className="row-value">{formatShortRange(firstMonday, lastSunday)}</span>
          </div>
          <div className="row">
            <span>Недель</span>
            <span className="row-value">{T.maxWeek}</span>
          </div>
          <div className="row">
            <span>Сейчас</span>
            <span className="row-value">
              {T.inSemester(current) ? `${current}-я неделя, ${isEvenWeek(current) ? 'чётная' : 'нечётная'}` : current < 1 ? 'семестр не начался' : 'семестр окончен'}
            </span>
          </div>
        </Section>

        <Section title="Недели">
          {visibleWeeks.map((w) => (
            <div key={w} className="row kug-week" data-current={w === current || undefined}>
              <span className="kug-week-no">{w}</span>
              <span className="kug-week-dates">{formatShortRange(T.dayOf(w, 0), T.dayOf(w, 6))}</span>
              <span className="row-value">{isEvenWeek(w) ? 'чётная' : 'нечётная'}</span>
            </div>
          ))}
          {!all && (
            <button type="button" className="row row-btn row-link" onClick={() => setAll(true)}>
              <span>Все {T.maxWeek} недель</span>
            </button>
          )}
        </Section>

        {best && (
          <Section title="Твоя программа" footer="Официальный документ с сайта ГУУ: даты сессий, практик и каникул.">
            <button type="button" className="row row-btn kug-row" onClick={() => openLink(best.url)}>
              <span className="kug-row-text">
                <span className="kug-title">{best.title}</span>
                <span className="kug-sub">
                  {[best.code, best.level ? LEVEL_TITLES[best.level] : null, best.form].filter(Boolean).join(' · ')}
                </span>
              </span>
              <ExternalIcon className="row-check" />
            </button>
          </Section>
        )}

        <Section title="Графики всех программ (PDF)" footer="Источник: guu.ru → Сведения об образовательной организации → Образование.">
          <div className="row row-form">
            <input className="input" type="search" placeholder="Название или код программы" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {error && <div className="row row-text">Не получилось загрузить список. Проверь интернет.</div>}
          {!kug && !error && <div className="row row-text">Загружаю…</div>}
          {shown.slice(0, 80).map((k) => (
            <button key={k.url + k.title} type="button" className="row row-btn kug-row" onClick={() => openLink(k.url)}>
              <span className="kug-row-text">
                <span className="kug-title">{k.title}</span>
                <span className="kug-sub">{[k.code, k.level ? LEVEL_TITLES[k.level] : null, k.form].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight className="row-chevron" />
            </button>
          ))}
        </Section>
      </details>
    </>
  )
}
