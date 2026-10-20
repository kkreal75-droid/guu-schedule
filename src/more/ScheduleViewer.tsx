import { useEffect, useState, type ReactNode } from 'react'
import type { Timetable } from '../../shared/schedule-core'
import type { ScheduleEdit } from '../edits'
import { ScheduleScreen, initialCursor, type Cursor } from '../screens/ScheduleScreen'
import { buildTimetable, fetchGroup } from '../schedule'

// Чужое расписание — любая группа ГУУ или преподаватель («t-<id>»): по неделям, как главный экран,
// только без заметок. Своё расписание (главный экран) не трогает.
export function ScheduleViewer({ id, edits, actions }: { id: string; edits: ScheduleEdit[]; actions?: ReactNode }) {
  const [tt, setTt] = useState<Timetable | null>(null)
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
        edits={edits}
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
