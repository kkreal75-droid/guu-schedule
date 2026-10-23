import { useEffect, useState, type ReactNode } from 'react'
import { isTeacherKey, type Timetable } from '../../shared/schedule-core'
import type { GroupInfo } from '../../shared/groups'
import { callBot, botAvailable } from '../api'
import { NO_EXTRAS, type Extras } from '../../shared/edits-core'
import { GroupHeader } from '../components/GroupHeader'
import { groupInfo } from '../data'
import { ChevronLeft } from '../icons'
import { ScheduleScreen, initialCursor, type Cursor } from '../screens/ScheduleScreen'
import { buildTimetable, fetchGroup } from '../schedule'
import { haptic } from '../telegram'
import { t } from '../i18n'
import { trTeacher } from '../guu'

// Чужое расписание — любая группа ГУУ или преподаватель («t-<id>»): по неделям, как главный экран,
// только без заметок. Своё расписание (главный экран) не трогает. У преподавателя пары — с группами-чипами:
// нажатие — расписание группы здесь же («‹ Преподаватель» — назад).
export function ScheduleViewer({ id, actions }: { id: string; actions?: ReactNode }) {
  const [tt, setTt] = useState<Timetable | null>(null)
  // правки старост и подгруппы этой группы; у преподавателя — правки его групп (отмены, переносы)
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS)
  const [error, setError] = useState(false)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [sub, setSub] = useState<GroupInfo | null>(null) // открытая группа у пары преподавателя

  useEffect(() => {
    let alive = true
    setTt(null)
    setError(false)
    setExtras(NO_EXTRAS)
    setSub(null)
    fetchGroup(id).then(
      (file) => {
        if (!alive) return
        const built = buildTimetable([file])
        setTt(built)
        setCursor(initialCursor(built))
        if (!botAvailable()) return
        const groups = isTeacherKey(id) ? [...new Set(built.schedule.lessons.flatMap((l) => l.audience?.map((a) => a.id) ?? []))] : [id]
        if (groups.length) callBot<Extras>('/extras', { groups: groups.slice(0, 60) }).then((x) => alive && setExtras(x), () => {})
      },
      () => alive && setError(true),
    )
    return () => {
      alive = false
    }
  }, [id])

  if (sub) {
    return (
      <>
        <button type="button" className="page-back admin-sub-back" onClick={() => (haptic(), setSub(null), window.scrollTo(0, 0))}>
          <ChevronLeft /> {tt ? trTeacher(tt.nameOf(id)) : t('Назад')}
        </button>
        <ScheduleViewer id={sub.id} actions={<GroupHeader group={sub} />} />
      </>
    )
  }
  if (error) return <p className="lead">{t('Не удалось загрузить расписание. Проверьте интернет.')}</p>
  if (!tt || !cursor) return <p className="lead">{t('Загружаю расписание…')}</p>
  const openGroup = (group: string) =>
    groupInfo(group).then((g) => {
      if (!g) return
      setSub(g)
      window.scrollTo(0, 0)
    }, () => {})
  return (
    <>
      {actions}
      <ScheduleScreen
        tt={tt}
        readOnly
        extras={extras}
        group={tt.schedule.groups[0]}
        onGroup={isTeacherKey(id) ? openGroup : undefined}
        cursor={cursor}
        onCursorChange={setCursor}
        notes={{}}
        onSaveNote={() => {}}
      />
    </>
  )
}
