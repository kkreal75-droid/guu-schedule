import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { ChevronRight } from '../icons'
import { haptic } from '../telegram'
import { t, tn } from '../i18n'

// Поиск преподавателя по фамилии (teachers.json): онбординг и «Ещё → Расписание преподавателя»
export function TeacherPicker({ onPick }: { onPick: (t: TeacherInfo) => void }) {
  const [list, setList] = useState<TeacherInfo[] | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const load = useCallback(() => {
    setError(false)
    loadTeachers().then((d) => setList(d.teachers), () => setError(true))
  }, [])
  useEffect(load, [load])
  const found = useMemo(() => (list ? searchTeachers(list, query) : []), [list, query])

  if (error) {
    return (
      <div className="ob-hero">
        <p className="ob-text">{t('Не получилось загрузить список преподавателей.')}</p>
        <button type="button" className="button-secondary" onClick={load}>
          {t('Повторить')}
        </button>
      </div>
    )
  }
  return (
    <div className="gsearch">
      <input
        className="input gsearch-input"
        type="search"
        autoFocus
        placeholder={t('Например, Денисова')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('Фамилия преподавателя')}
      />
      {!list && <p className="gsearch-empty">{t('Загружаю…')}</p>}
      {list && query.trim().length >= 2 && !found.length && (
        <p className="gsearch-empty">{t('Не нашёл такую фамилию в расписании ГУУ.')}</p>
      )}
      {found.length > 0 && (
        <div className="section-body gsearch-list">
          {found.map((teacher) => (
            <button
              key={teacher.id}
              type="button"
              className="row row-btn gsearch-row"
              onClick={() => {
                haptic()
                onPick(teacher)
              }}
            >
              <span className="gsearch-text">
                <span className="gsearch-name">{teacher.name}</span>
                <span className="gsearch-sub">
                  {teacher.subjects.slice(0, 2).join(', ')}
                  {teacher.subjects.length > 2 ? ` ${tn(teacher.subjects.length - 2, 'и ещё {n}|и ещё {n}|и ещё {n}')}` : ''}
                </span>
              </span>
              <ChevronRight className="row-chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
