import { useState } from 'react'
import { teacherKey } from '../../shared/schedule-core'
import type { TeacherInfo } from '../data'
import { TeacherPicker } from '../onboarding/TeacherPicker'
import { ScheduleViewer } from './ScheduleViewer'
import { t } from '../i18n'

// «Ещё → Расписание преподавателя»: поиск по фамилии, расписание по неделям (у пар — группы)
export function TeacherSchedulePage({ initial }: { initial?: { id: string; name: string } }) {
  const [picked, setPicked] = useState<Pick<TeacherInfo, 'id' | 'name'> | null>(initial ?? null)
  if (!picked) return <TeacherPicker onPick={setPicked} />
  return (
    <ScheduleViewer
      id={teacherKey(picked.id)}
      actions={
        <div className="viewer-head">
          <div className="viewer-title">
            <span className="viewer-name">{picked.name}</span>
            <span className="viewer-sub">{t('Расписание по файлам ГУУ · у пар — группы')}</span>
          </div>
          <div className="viewer-actions">
            <button type="button" className="chip" onClick={() => setPicked(null)}>
              {t('Другой преподаватель')}
            </button>
          </div>
        </div>
      }
    />
  )
}
