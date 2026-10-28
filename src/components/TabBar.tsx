import { Icon, type IconName } from '../icons'
import { t } from '../i18n'

export type Tab = 'schedule' | 'more' | 'profile'

// Нижнее меню во всю ширину: тонкая иконка и подпись, активный раздел — цвет акцента
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const item = (id: Tab, label: string, icon: IconName) => (
    <button type="button" className="tab" aria-current={tab === id} onClick={() => onTab(id)}>
      <Icon name={icon} size={25} strokeWidth={tab === id ? 2.2 : 1.9} />
      <span>{label}</span>
    </button>
  )
  return (
    <nav className="tabbar" aria-label={t('Разделы')}>
      <div className="tabbar-inner">
        {item('schedule', t('Расписание'), 'calendar')}
        {item('more', t('Сервисы'), 'compass')}
        {item('profile', t('Профиль'), 'person')}
      </div>
    </nav>
  )
}
