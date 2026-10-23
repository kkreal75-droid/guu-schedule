import { useFavorites } from '../favorites'
import { haptic } from '../telegram'
import { t } from '../i18n'

// «☆ В избранное» / «★ В избранном» — группа или преподаватель («t-<id>») в ленте над расписанием (этап 12)
export function FavoriteToggle({ id }: { id: string }) {
  const favorites = useFavorites()
  if (!favorites) return null
  if (favorites.home === id) return <span className="viewer-hint">{t('Это твоё расписание (★)')}</span>
  const on = favorites.list.includes(id)
  return (
    <button
      type="button"
      className="chip"
      data-on={on || undefined}
      onClick={() => {
        haptic('light')
        if (on) favorites.remove(id)
        else favorites.add(id)
      }}
    >
      {on ? t('★ В избранном') : t('☆ В избранное')}
    </button>
  )
}
