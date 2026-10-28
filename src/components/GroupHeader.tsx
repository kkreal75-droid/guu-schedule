import type { GroupInfo } from '../../shared/groups'
import { FavoriteToggle } from './FavoriteToggle'
import { GroupSubtitle } from './GroupSubtitle'
import { t } from '../i18n'

// Шапка расписания группы: название крупно, программа · институт · курс, «☆ В избранное», «Другая группа»
export function GroupHeader({ group, onOther }: { group: GroupInfo; onOther?: () => void }) {
  return (
    <div className="viewer-head">
      <h1 className="page-title" lang="ru">
        {group.name}
      </h1>
      <GroupSubtitle group={group} className="viewer-sub" />
      <div className="viewer-actions">
        <FavoriteToggle id={group.id} />
        {onOther && (
          <button type="button" className="link-btn link-btn-gray" onClick={onOther}>
            {t('Другая группа')}
          </button>
        )}
      </div>
    </div>
  )
}
