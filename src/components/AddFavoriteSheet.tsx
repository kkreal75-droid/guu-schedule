import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchGroups, type GroupInfo } from '../../shared/groups'
import { teacherKey } from '../../shared/schedule-core'
import { loadGroups, loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { GroupSubtitle } from './GroupSubtitle'
import { ChevronRight } from '../icons'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t } from '../i18n'
import { trSubject, trTeacher } from '../guu'

// «+» в ленте над расписанием (этап 12): одно поле — поиск сразу по группам и преподавателям, результаты двумя
// секциями; выбранное встаёт в конец избранного.
type Props = {
  exclude: string[] // уже в ленте (своё и избранное)
  onPick: (id: string) => void
  onClose: () => void
}

export function AddFavoriteSheet({ exclude, onPick, onClose }: Props) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [teachers, setTeachers] = useState<TeacherInfo[] | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    loadGroups().then((index) => setGroups(index.groups), () => setError(true))
    loadTeachers().then((data) => setTeachers(data.teachers), () => setError(true))
  }, [])
  useBackButton(onClose)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const q = query.trim()
  const foundGroups = useMemo(() => (groups && q ? searchGroups(groups, q, 20).filter((g) => !exclude.includes(g.id)) : []), [groups, q, exclude])
  const foundTeachers = useMemo(
    () => (teachers && q ? searchTeachers(teachers, q, 20).filter((x) => !exclude.includes(teacherKey(x.id))) : []),
    [teachers, q, exclude],
  )
  const pick = (id: string) => {
    haptic('light')
    onPick(id)
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-tall" role="dialog" aria-modal="true" aria-label={t('Добавить в избранное')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="sheet-heading">
            <div className="sheet-title">{t('Добавить в избранное')}</div>
            <div className="sheet-sub">{t('Группа или преподаватель — появится в ленте над расписанием')}</div>
          </div>
          <button type="button" className="sheet-done" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
        <div className="gsearch">
          <input
            className="input gsearch-input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoFocus
            placeholder={t('Группа или фамилия: «мб 1-2», «Королева»')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('Поиск группы или преподавателя')}
          />
          {error && !groups && !teachers && <p className="gsearch-empty">{t('Не получилось загрузить списки. Проверь интернет.')}</p>}
          {!error && (!groups || !teachers) && <p className="gsearch-empty">{t('Загружаю…')}</p>}
          {q && groups && teachers && !foundGroups.length && !foundTeachers.length && (
            <p className="gsearch-empty">{t('Ничего не нашёл. Попробуй по-другому: «гму 2», «Денисова».')}</p>
          )}
          {foundGroups.length > 0 && (
            <>
              <h3 className="section-title fav-search-title">{t('Группы')}</h3>
              <div className="section-body gsearch-list">
                {foundGroups.map((g) => (
                  <button key={g.id} type="button" className="row row-btn gsearch-row" onClick={() => pick(g.id)}>
                    <span className="gsearch-text">
                      <span className="gsearch-name" lang="ru">
                        {g.name}
                      </span>
                      <GroupSubtitle group={g} className="gsearch-sub" />
                    </span>
                    <ChevronRight className="row-chevron" />
                  </button>
                ))}
              </div>
            </>
          )}
          {foundTeachers.length > 0 && (
            <>
              <h3 className="section-title fav-search-title">{t('Преподаватели')}</h3>
              <div className="section-body gsearch-list">
                {foundTeachers.map((teacher) => (
                  <button key={teacher.id} type="button" className="row row-btn gsearch-row" onClick={() => pick(teacherKey(teacher.id))}>
                    <span className="gsearch-text">
                      <span className="gsearch-name">{trTeacher(teacher.name)}</span>
                      {teacher.subjects.length > 0 && <span className="gsearch-sub">{teacher.subjects.slice(0, 3).map(trSubject).join(' · ')}</span>}
                    </span>
                    <ChevronRight className="row-chevron" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
