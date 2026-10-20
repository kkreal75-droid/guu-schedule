import { useEffect, useState, type ReactNode } from 'react'
import type { Timetable } from '../../shared/schedule-core'
import { callBot, botAvailable } from '../api'
import { NO_EXTRAS, type Extras } from '../../shared/edits-core'
import { ScheduleScreen, initialCursor, type Cursor } from '../screens/ScheduleScreen'
import { buildTimetable, fetchGroup } from '../schedule'

// Чужое расписание — любая группа ГУУ или преподаватель («t-<id>»): по неделям, как главный экран,
// только без заметок. Своё расписание (главный экран) не трогает.
export function ScheduleViewer({ id, actions }: { id: string; actions?: ReactNode }) {
  const [tt, setTt] = useState<Timetable | null>(null)
  // правки старост и подгруппы этой группы (у преподавателя — нет)
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS)
  useEffect(() => {
    setExtras(NO_EXTRAS)
    if (id.startsWith('t-') || !botAvailable()) return
    let alive = true
    callBot<Extras>('/extras', { groups: [id] }).then((x) => alive && setExtras(x), () => {})
    return () => {
      alive = false
    }
  }, [id])
  const [error, setError] = useState(false)
  const [cursor, setCursor] = useState<Cursor | null>(null)

  useEffect(() => {
    let alive = true
    setTt(null)
    setError(false)
    fetchGroup(id).then(
      (file) => {
        if (!alive) return
        const built = buildTimetable([file])
        setTt(built)
        setCursor(initialCursor(built))
      },
      () => alive && setError(true),
    )
    return () => {
      alive = false
    }
  }, [id])

  if (error) return <p className="lead">Не получилось загрузить расписание. Проверьте интернет.</p>
  if (!tt || !cursor) return <p className="lead">Загружаю расписание…</p>
  return (
    <>
      {actions}
      <ScheduleScreen
        tt={tt}
        readOnly
        extras={extras}
        group={tt.schedule.groups[0]}
        groups={tt.schedule.groups}
        onGroupChange={() => {}}
        cursor={cursor}
        onCursorChange={setCursor}
        notes={{}}
        onSaveNote={() => {}}
      />
    </>
  )
}
