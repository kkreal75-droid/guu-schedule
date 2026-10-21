import { useEffect, useState } from 'react'
import { isMbGroup, type GroupInfo } from '../../shared/groups'
import { groupSubtitle } from '../guu'
import { loadGroups } from '../data'
import { GroupSearch } from '../onboarding/GroupSearch'
import { MAX_FAVORITES, type Prefs } from '../prefs'
import { haptic } from '../telegram'
import { ScheduleViewer } from './ScheduleViewer'
import { t } from '../i18n'

// «Ещё → Расписание группы»: любая группа ГУУ поиском, по неделям; «★ В избранное» — её пары
// появятся над своим расписанием (переключатель).
export function GroupSchedulePage({
  prefs,
  onPrefsChange,
}: {
  prefs: Prefs
  onPrefsChange: (patch: Partial<Prefs>) => void
}) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<GroupInfo | null>(null)
  useEffect(() => {
    loadGroups().then((index) => setGroups(index.groups), () => setError(true))
  }, [])

  if (error) return <p className="lead">{t('Не получилось загрузить список групп. Проверь интернет.')}</p>
  if (!groups) return <p className="lead">{t('Загружаю группы…')}</p>
  if (!picked) return <GroupSearch groups={groups} autoFocus={false} onPick={setPicked} />

  const favorite = prefs.favorites.includes(picked.id)
  const own = prefs.role === 'student' && (picked.id === prefs.group || (isMbGroup(prefs.group) && isMbGroup(picked.id)))
  const full = !favorite && prefs.favorites.length >= MAX_FAVORITES
  const toggle = () => {
    haptic('light')
    onPrefsChange({
      favorites: favorite ? prefs.favorites.filter((g) => g !== picked.id) : [...prefs.favorites, picked.id],
    })
  }

  return (
    <ScheduleViewer
      id={picked.id}
      actions={
        <div className="viewer-head">
          <div className="viewer-title">
            <span className="viewer-name">{picked.name}</span>
            <span className="viewer-sub">{groupSubtitle(picked)}</span>
          </div>
          <div className="viewer-actions">
            {own ? (
              <span className="viewer-hint">{t('Уже над вашим расписанием')}</span>
            ) : (
              <button type="button" className="chip" data-on={favorite || undefined} disabled={full} onClick={toggle}>
                {favorite ? t('★ В избранном') : t('☆ В избранное')}
              </button>
            )}
            <button type="button" className="chip" onClick={() => setPicked(null)}>
              {t('Другая группа')}
            </button>
          </div>
          {full && <p className="viewer-hint">{t('Избранных групп уже {n} — убери лишнюю в «Профиле».', { n: MAX_FAVORITES })}</p>}
          {favorite && <p className="viewer-hint">{t('Переключатель над расписанием — на вкладке «Расписание».')}</p>}
        </div>
      }
    />
  )
}
