import { useFavorites } from '../favorites'
import { haptic } from '../telegram'
import { t } from '../i18n'
import { Icon } from '../icons'

// «☆ В избранное» / «★ В избранном» — маленькая кнопка светлого акцента: группа или преподаватель («t-<id>») вкладкой
// над расписанием (этап 12); нажатие ещё раз — убрать
export function FavoriteToggle({ id }: { id: string }) {
  const favorites = useFavorites()
  if (!favorites) return null
  if (favorites.home === id) return <span className="viewer-hint">{t('Это твоё расписание')}</span>
  const on = favorites.list.includes(id)
  return (
    <button
      type="button"
      className="button-small"
      aria-pressed={on}
      onClick={() => {
        haptic('light')
        if (on) favorites.remove(id)
        else favorites.add(id)
      }}
    >
      <Icon name="star" size={15} strokeWidth={1.9} fill={on ? 'currentColor' : 'none'} />
      {on ? t('В избранном') : t('В избранное')}
    </button>
  )
}
