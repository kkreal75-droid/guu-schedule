import type { GroupInfo } from '../../shared/groups'
import { groupSubtitleParts } from '../guu'

// «International Business · ИУПСиБК · Year 1»: длинная программа сокращается многоточием, институт и курс видны
// всегда; аббревиатура института — данные ГУУ (lang="ru")
export function GroupSubtitle({ group, className }: { group: GroupInfo; className: string }) {
  const [program, institute, course] = groupSubtitleParts(group)
  return (
    <span className={`group-sub ${className}`}>
      <span className="group-sub-program">{program}</span>
      <span className="group-sub-rest">
        {' · '}
        <span lang={/[А-Яа-яЁё]/.test(institute) ? 'ru' : undefined}>{institute}</span>
        {' · '}
        {course}
      </span>
    </span>
  )
}
