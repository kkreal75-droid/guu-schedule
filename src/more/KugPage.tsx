import { useEffect, useMemo, useState } from 'react'
import { groupCalendar, type GroupCalendar } from '../academic'
import type { GroupInfo, Level } from '../../shared/groups'
import { isEvenWeek } from '../../shared/format-core'
import { Row } from '../components/Row'
import { SearchField } from '../components/SearchField'
import { Section } from '../components/Section'
import { groupInfo } from '../data'
import { formatShortRange } from '../format'
import { dataUrl, getTimetable, moscowNow } from '../schedule'
import { haptic, openLink } from '../telegram'
import { AcademicCalendar } from './AcademicCalendar'
import { t, tKnown } from '../i18n'
import { levelTitle } from '../onboarding/Onboarding'
import { trProgram } from '../guu'

// «Сервисы → Учебный график»: обратный отсчёт и ближайшие даты (AcademicCalendar; данные — src/academic.ts),
// по строке «Недели семестра и графики (PDF)» — недели по расписанию ГУУ и официальные графики программ — PDF со
// страницы «Сведения → Образование» (kug.json, собирает update.py)

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
  const [weeksOpen, setWeeksOpen] = useState(false)
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

  const meta = (k: Kug) => [k.code, k.level ? levelTitle(k.level) : null, k.form && (tKnown(k.form) ?? k.form)].filter(Boolean).join(' · ')
  return (
    <>
      {calendar ? (
        <AcademicCalendar
          periods={calendar.periods}
          typical={calendar.typical}
          onWeeks={() => setWeeksOpen((v) => !v)}
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

      {weeksOpen && (
        <>
          <Section
            title={t('Семестр по расписанию ГУУ')}
            footer={t('Номера недель и чётность — как в файлах расписания. Сессия и каникулы — в графике своей программы ниже.')}
          >
            <Row title={t('Занятия')} value={formatShortRange(firstMonday, lastSunday)} />
            <Row title={t('Недель')} value={T.maxWeek} />
            <Row
              title={t('Сейчас')}
              value={
                T.inSemester(current)
                  ? isEvenWeek(current)
                    ? t('{n} неделя, чётная', { n: current })
                    : t('{n} неделя, нечётная', { n: current })
                  : current < 1
                    ? t('семестр не начался')
                    : t('семестр окончен')
              }
            />
          </Section>

          <Section title={t('Недели')}>
            {visibleWeeks.map((w) => (
              <Row
                key={w}
                className={w === current ? 'is-now' : undefined}
                title={t('{n} неделя', { n: w })}
                sub={formatShortRange(T.dayOf(w, 0), T.dayOf(w, 6))}
                value={isEvenWeek(w) ? t('чётная') : t('нечётная')}
              />
            ))}
            {!all && <Row title={<span className="row-link">{t('Все {n} недель', { n: T.maxWeek })}</span>} onClick={() => (haptic(), setAll(true))} />}
          </Section>

          {best && (
            <Section title={t('Твоя программа')} footer={t('Официальный документ с сайта ГУУ: даты сессий, практик и каникул.')}>
              <Row
                title={<span lang={trProgram(best.title) === best.title ? 'ru' : undefined}>{trProgram(best.title)}</span>}
                sub={meta(best)}
                value="↗"
                onClick={() => openLink(best.url)}
              />
            </Section>
          )}

          <section className="section">
            <h3 className="section-title">{t('Графики всех программ (PDF)')}</h3>
            <div className="section-search">
              <SearchField value={query} onChange={setQuery} placeholder={t('Название или код программы')} label={t('Название или код программы')} />
            </div>
            <div className="list">
              {error && <Row title={t('Не получилось загрузить список. Проверь интернет.')} />}
              {!kug && !error && <Row title={t('Загружаю…')} />}
              {shown.slice(0, 80).map((k) => (
                <Row
                  key={k.url + k.title}
                  title={<span lang={trProgram(k.title) === k.title ? 'ru' : undefined}>{trProgram(k.title)}</span>}
                  sub={meta(k)}
                  value="↗"
                  onClick={() => openLink(k.url)}
                />
              ))}
            </div>
            <p className="section-footer">{t('Источник: guu.ru → Сведения об образовательной организации → Образование.')}</p>
          </section>
        </>
      )}
    </>
  )
}
