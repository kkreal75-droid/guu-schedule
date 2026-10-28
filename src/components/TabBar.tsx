import { t } from '../i18n'

export type Tab = 'schedule' | 'more' | 'profile'

// Нижнее меню во всю ширину: эмодзи и подпись, активный раздел — красный
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const item = (id: Tab, label: string, emoji: string) => (
    <button type="button" className="tab" aria-current={tab === id} onClick={() => onTab(id)}>
      <span className="tab-emoji" aria-hidden="true">
        {emoji}
      </span>
      <span>{label}</span>
    </button>
  )
  return (
    <nav className="tabbar" aria-label={t('Разделы')}>
      <div className="tabbar-inner">
        {item('schedule', t('Расписание'), '📅')}
        {item('more', t('Сервисы'), '🧭')}
        {item('profile', t('Профиль'), '👤')}
      </div>
    </nav>
  )
}
