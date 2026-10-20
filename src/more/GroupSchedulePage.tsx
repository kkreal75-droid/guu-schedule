import { useEffect, useState } from 'react'
import { groupSubtitle, isMbGroup, type GroupInfo } from '../../shared/groups'
import { loadGroups } from '../data'
import type { ScheduleEdit } from '../edits'
import { GroupSearch } from '../onboarding/GroupSearch'
import { MAX_FAVORITES, type Prefs } from '../prefs'
import { haptic } from '../telegram'
import { ScheduleViewer } from './ScheduleViewer'

// «Ещё → Расписание группы»: любая группа ГУУ поиском, по неделям; «★ В избранное» — её пары
// появятся над своим расписанием (переключатель).
export function GroupSchedulePage({
  prefs,
  onPrefsChange,
  edits,
}: {
  prefs: Prefs
  onPrefsChange: (patch: Partial<Prefs>) => void
  edits: ScheduleEdit[]
}) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<GroupInfo | null>(null)
  useEffect(() => {
    loadGroups().then((index) => setGroups(index.groups), () => setError(true))
  }, [])

  if (error) return <p className="lead">Не получилось загрузить список групп. Проверьте интернет.</p>
  if (!groups) return <p className="lead">Загружаю группы…</p>
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
      edits={edits}
      actions={
        <div className="viewer-head">
          <div className="viewer-title">
            <span className="viewer-name">{picked.name}</span>
            <span className="viewer-sub">{groupSubtitle(picked)}</span>
          </div>
          <div className="viewer-actions">
            {own ? (
              <span className="viewer-hint">Уже над вашим расписанием</span>
            ) : (
              <button type="button" className="chip" data-on={favorite || undefined} disabled={full} onClick={toggle}>
                {favorite ? '★ В избранном' : '☆ В избранное'}
              </button>
            )}
            <button type="button" className="chip" onClick={() => setPicked(null)}>
              Другая группа
            </button>
          </div>
          {full && <p className="viewer-hint">В избранном уже {MAX_FAVORITES} групп — уберите лишнюю в «Профиле».</p>}
          {favorite && <p className="viewer-hint">Переключатель над расписанием — на вкладке «Расписание».</p>}
        </div>
      }
    />
  )
}
