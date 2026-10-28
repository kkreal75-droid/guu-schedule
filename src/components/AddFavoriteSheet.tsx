import { useEffect, useMemo, useState } from 'react'
import { searchGroups, type GroupInfo } from '../../shared/groups'
import { teacherKey } from '../../shared/schedule-core'
import { loadGroups, loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { GroupSubtitle } from './GroupSubtitle'
import { Row } from './Row'
import { SearchField } from './SearchField'
import { Sheet } from './Sheet'
import { haptic } from '../telegram'
import { t } from '../i18n'
import { trSubject, trTeacher } from '../guu'

// «+» над расписанием (этап 12): окно снизу, одно поле — поиск сразу по группам и преподавателям; выбранное
// встаёт последней вкладкой.
type Props = {
  exclude: string[] // уже во вкладках (своё и избранное)
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

  return (
    <Sheet label={t('Добавить в избранное')} onClose={onClose} className="sheet-tall">
      <h2 className="sheet-title">{t('Добавить в избранное')}</h2>
      <p className="sheet-sub">{t('Группа или преподаватель появится вкладкой над расписанием.')}</p>
      <div className="gsearch">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('Группа или фамилия: «мб 1-2», «Королева»')}
          label={t('Поиск группы или преподавателя')}
          autoFocus
        />
        {error && !groups && !teachers && <p className="gsearch-empty">{t('Не получилось загрузить списки. Проверь интернет.')}</p>}
        {!error && (!groups || !teachers) && <p className="gsearch-empty">{t('Загружаю…')}</p>}
        {q && groups && teachers && !foundGroups.length && !foundTeachers.length && (
          <p className="gsearch-empty">{t('Ничего не нашёл. Попробуй по-другому: «гму 2», «Денисова».')}</p>
        )}
        {(foundGroups.length > 0 || foundTeachers.length > 0) && (
          <div className="list">
            {foundGroups.map((g) => (
              <Row key={g.id} emoji="👥" title={g.name} lang="ru" sub={<GroupSubtitle group={g} className="gsearch-sub" />} chevron onClick={() => pick(g.id)} />
            ))}
            {foundTeachers.map((teacher) => (
              <Row
                key={teacher.id}
                emoji="👩‍🏫"
                title={trTeacher(teacher.name)}
                sub={<span className="gsearch-sub">{[t('Преподаватель'), ...teacher.subjects.slice(0, 2).map(trSubject)].join(' · ')}</span>}
                chevron
                onClick={() => pick(teacherKey(teacher.id))}
              />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
