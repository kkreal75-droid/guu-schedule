import type { GroupInfo } from '../../shared/groups'
import { FavoriteToggle } from './FavoriteToggle'
import { GroupSubtitle } from './GroupSubtitle'
import { useFavorites } from '../favorites'
import { t } from '../i18n'

// Шапка расписания группы: имя, программа · институт · курс, «★ В избранное», «Другая группа»
export function GroupHeader({ group, onOther }: { group: GroupInfo; onOther?: () => void }) {
  const favorites = useFavorites()
  return (
    <div className="viewer-head">
      <div className="viewer-title">
        <span className="viewer-name" lang="ru">
          {group.name}
        </span>
        <GroupSubtitle group={group} className="viewer-sub" />
      </div>
      <div className="viewer-actions">
        <FavoriteToggle id={group.id} />
        {onOther && (
          <button type="button" className="chip" onClick={onOther}>
            {t('Другая группа')}
          </button>
        )}
      </div>
      {favorites?.list.includes(group.id) && <p className="viewer-hint">{t('Чип — в ленте над расписанием на вкладке «Расписание».')}</p>}
    </div>
  )
}
