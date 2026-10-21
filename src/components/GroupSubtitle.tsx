import type { GroupInfo } from '../../shared/groups'
import { groupSubtitleParts } from '../guu'

// «International Business · ИУПСиБК · Year 1»: аббревиатура института — данные ГУУ (lang="ru")
export function GroupSubtitle({ group, className }: { group: GroupInfo; className: string }) {
  const [program, institute, course] = groupSubtitleParts(group)
  return (
    <span className={className}>
      {program} · <span lang={/[А-Яа-яЁё]/.test(institute) ? 'ru' : undefined}>{institute}</span> · {course}
    </span>
  )
}
