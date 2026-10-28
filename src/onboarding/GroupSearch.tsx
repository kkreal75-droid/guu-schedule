import { useMemo, useState } from 'react'
import { searchGroups, type GroupInfo } from '../../shared/groups'
import { GroupSubtitle } from '../components/GroupSubtitle'
import { Row } from '../components/Row'
import { SearchField } from '../components/SearchField'
import { haptic } from '../telegram'
import { t } from '../i18n'

// Поиск по всем группам ГУУ: «мб 1-1», «гму 2-3», «маркетинг 2», «международный бизнес»
export function GroupSearch({
  groups,
  onPick,
  autoFocus = true,
  placeholder = t('Например, МБ(МП) 1-1 или маркетинг 2'),
}: {
  groups: GroupInfo[]
  onPick: (group: GroupInfo) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchGroups(groups, query, 40), [groups, query])

  return (
    <div className="gsearch">
      <SearchField value={query} onChange={setQuery} placeholder={placeholder} label={t('Поиск группы')} autoFocus={autoFocus} />
      {query.trim() && !found.length && <p className="gsearch-empty">{t('Ничего не нашёл. Попробуй по-другому: «гму 2», «бизнес-информатика».')}</p>}
      {found.length > 0 && (
        <div className="list">
          {found.map((g) => (
            <Row
              key={g.id}
              title={g.name}
              lang="ru"
              sub={<GroupSubtitle group={g} className="gsearch-sub" />}
              chevron
              onClick={() => {
                haptic()
                onPick(g)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
