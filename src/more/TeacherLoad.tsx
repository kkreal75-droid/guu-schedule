import { useEffect, useMemo, useState } from 'react'
import { NO_EXTRAS, type Extras } from '../../shared/edits-core'
import { courseOccurrences, progressOf, type Progress } from '../../shared/progress-core'
import { teacherKey, type Timetable } from '../../shared/schedule-core'
import { botAvailable, callBot } from '../api'
import { Section } from '../components/Section'
import { formatDayShort } from '../format'
import { buildTimetable, fetchGroup, moscowNow } from '../schedule'
import { t, tn } from '../i18n'
import { kindShort, trSubject } from '../guu'

// «Нагрузка в семестре» в карточке преподавателя (этап 12): предметы и группы по связке «предмет + вид + группы»
// с ходом — «Макроэкономика · ПЗ · МБ(МП) 1-2 — 7 из 12 · осталось 5 · последнее 08.12 (15-я неделя)».
// Недели — из файла ГУУ, с правками групп (отмены, переносы, пары от старост); предметы на весь семестр — без хода.
type Row = { key: string; subject: string; kind: string | null; groups: string; progress: Progress }

export function TeacherLoad({ id }: { id: string }) {
  const [tt, setTt] = useState<Timetable | null>(null)
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchGroup(teacherKey(id)).then(
      (file) => {
        if (!alive) return
        const built = buildTimetable([file])
        setTt(built)
        const groups = [...new Set(built.schedule.lessons.flatMap((l) => l.audience?.map((a) => a.id) ?? []))]
        if (groups.length && botAvailable()) callBot<Extras>('/extras', { groups: groups.slice(0, 60) }).then((x) => alive && setExtras(x), () => {})
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [id])

  const rows = useMemo(() => {
    if (!tt) return []
    const key = teacherKey(id)
    const names = new Map(tt.schedule.lessons.flatMap((l) => l.audience ?? []).map((a) => [a.id, a.name]))
    const now = moscowNow()
    const out: Row[] = []
    for (const [k, list] of courseOccurrences(tt, key, extras)) {
      const progress = progressOf(list, now)
      if (!progress) continue
      const [subject, kind, ids] = k.split('|')
      out.push({ key: k, subject, kind: kind || null, groups: ids.split(',').map((g) => names.get(g) ?? g).join(', '), progress })
    }
    // сначала идущие (кто раньше закончится — выше), потом закончившиеся
    return out.sort(
      (a, b) => Number(a.progress.finished) - Number(b.progress.finished) || a.progress.last.day - b.progress.last.day || a.subject.localeCompare(b.subject),
    )
  }, [tt, extras, id])

  if (failed) return null
  if (!tt) return <p className="lead">{t('Считаю нагрузку…')}</p>
  if (!rows.length) return null
  return (
    <Section title={t('Нагрузка в семестре')} footer={t('По неделям из файлов ГУУ с правками старост. Пара — 2 ак. часа.')}>
      {rows.map(({ key, subject, kind, groups, progress: p }) => (
        <div key={key} className="row load-row" data-finished={p.finished || undefined}>
          <div className="load-title">
            {trSubject(subject)}
            {kind && ` · ${kindShort(kind)}`} · <span lang="ru">{groups}</span>
          </div>
          <div className="load-meta">
            {p.finished
              ? t('закончилось {date} · {n} {lessons}', { date: formatDayShort(p.last.day), n: p.total, lessons: tn(p.total, 'занятие|занятия|занятий') })
              : t('{done} из {total} · осталось {left} · последнее {date} ({week})', {
                  done: p.done,
                  total: p.total,
                  left: p.left,
                  date: formatDayShort(p.last.day),
                  week: t('{n}-я неделя', { n: p.last.week }),
                })}
            {' · '}
            {p.hours} {tn(p.hours, 'ак. час|ак. часа|ак. часов')}
          </div>
          {!p.finished && (
            <div className="progress load-bar" aria-hidden="true">
              <div style={{ width: `${(p.done / p.total) * 100}%` }} />
            </div>
          )}
        </div>
      ))}
    </Section>
  )
}
