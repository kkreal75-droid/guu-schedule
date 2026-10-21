import { useMemo, useState } from 'react'
import { searchGroups, type GroupInfo } from '../../shared/groups'
import { GroupSubtitle } from '../components/GroupSubtitle'
import { ChevronRight } from '../icons'
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
      <input
        className="input gsearch-input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('Поиск группы')}
      />
      {query.trim() && !found.length && <p className="gsearch-empty">{t('Ничего не нашёл. Попробуй по-другому: «гму 2», «бизнес-информатика».')}</p>}
      {found.length > 0 && (
        <div className="section-body gsearch-list">
          {found.map((g) => (
            <button
              key={g.id}
              type="button"
              className="row row-btn gsearch-row"
              onClick={() => {
                haptic()
                onPick(g)
              }}
            >
              <span className="gsearch-text">
                <span className="gsearch-name" lang="ru">
                  {g.name}
                </span>
                <GroupSubtitle group={g} className="gsearch-sub" />
              </span>
              <ChevronRight className="row-chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
