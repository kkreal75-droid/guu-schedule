import { useState } from 'react'
import { teacherKey } from '../../shared/schedule-core'
import type { TeacherInfo } from '../data'
import { TeacherPicker } from '../onboarding/TeacherPicker'
import { FavoriteToggle } from '../components/FavoriteToggle'
import { ScheduleViewer } from './ScheduleViewer'
import { t } from '../i18n'
import { trTeacher } from '../guu'

// «Сервисы → Расписание преподавателя»: поиск по фамилии, расписание по неделям (у пар — группы).
// Заголовок страницы рисует сама: до выбора — «Расписание преподавателя», после — фамилия.
export function TeacherSchedulePage({ initial }: { initial?: { id: string; name: string } }) {
  const [picked, setPicked] = useState<Pick<TeacherInfo, 'id' | 'name'> | null>(initial ?? null)
  if (!picked) {
    return (
      <>
        <h1 className="page-title page-title-gap">{t('Расписание преподавателя')}</h1>
        <TeacherPicker onPick={setPicked} />
      </>
    )
  }
  return (
    <ScheduleViewer
      id={teacherKey(picked.id)}
      actions={
        <div className="viewer-head">
          <h1 className="page-title">{trTeacher(picked.name)}</h1>
          <p className="viewer-sub">{t('По файлам ГУУ, у пар указаны группы')}</p>
          <div className="viewer-actions">
            <FavoriteToggle id={teacherKey(picked.id)} />
            <button type="button" className="link-btn" onClick={() => setPicked(null)}>
              {t('Другой преподаватель')}
            </button>
          </div>
        </div>
      }
    />
  )
}
