import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { Row } from '../components/Row'
import { SearchField } from '../components/SearchField'
import { haptic } from '../telegram'
import { t, tn } from '../i18n'
import { trSubject, trTeacher } from '../guu'

// Поиск преподавателя по фамилии (teachers.json): регистрация и «Сервисы → Расписание преподавателя»
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
      <div className="gsearch">
        <p className="gsearch-empty">{t('Не получилось загрузить список преподавателей.')}</p>
        <button type="button" className="link-btn" onClick={load}>
          {t('Повторить')}
        </button>
      </div>
    )
  }
  return (
    <div className="gsearch">
      <SearchField value={query} onChange={setQuery} placeholder={t('Например, Денисова')} label={t('Фамилия преподавателя')} autoFocus />
      {!list && <p className="gsearch-empty">{t('Загружаю…')}</p>}
      {list && query.trim().length >= 2 && !found.length && <p className="gsearch-empty">{t('Не нашёл такую фамилию в расписании ГУУ.')}</p>}
      {found.length > 0 && (
        <div className="list">
          {found.map((teacher) => (
            <Row
              key={teacher.id}
              title={trTeacher(teacher.name)}
              sub={
                <span className="gsearch-sub">
                  {teacher.subjects.slice(0, 2).map(trSubject).join(', ')}
                  {teacher.subjects.length > 2 ? ` ${tn(teacher.subjects.length - 2, 'и ещё {n}|и ещё {n}|и ещё {n}')}` : ''}
                </span>
              }
              chevron
              onClick={() => {
                haptic()
                onPick(teacher)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
