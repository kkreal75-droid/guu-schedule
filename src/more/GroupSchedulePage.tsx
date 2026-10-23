import { useEffect, useState } from 'react'
import type { GroupInfo } from '../../shared/groups'
import { GroupHeader } from '../components/GroupHeader'
import { loadGroups } from '../data'
import { GroupSearch } from '../onboarding/GroupSearch'
import { ScheduleViewer } from './ScheduleViewer'
import { t } from '../i18n'

// «Ещё → Расписание группы»: любая группа ГУУ поиском, по неделям; «★ В избранное» — её чип в ленте над своим
// расписанием. initial — группа, открытая нажатием на чип группы у пары преподавателя.
export function GroupSchedulePage({ initial }: { initial?: string }) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<GroupInfo | null>(null)
  useEffect(() => {
    loadGroups().then(
      (index) => {
        setGroups(index.groups)
        if (initial) setPicked(index.groups.find((g) => g.id === initial) ?? null)
      },
      () => setError(true),
    )
  }, [initial])

  if (error) return <p className="lead">{t('Не получилось загрузить список групп. Проверь интернет.')}</p>
  if (!groups) return <p className="lead">{t('Загружаю группы…')}</p>
  if (!picked) return <GroupSearch groups={groups} autoFocus={false} onPick={setPicked} />
  return <ScheduleViewer id={picked.id} actions={<GroupHeader group={picked} onOther={() => setPicked(null)} />} />
}
