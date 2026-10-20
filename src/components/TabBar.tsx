import { CalendarIcon, MoreIcon } from '../icons'
import { telegramUser } from '../telegram'

export type Tab = 'schedule' | 'more' | 'profile'

// Аватар Telegram на вкладке «Профиль»; нет фото — буква имени
export function Avatar({ size }: { size: number }) {
  const user = telegramUser()
  const letter = (user?.first_name ?? 'Г').slice(0, 1).toUpperCase()
  return user?.photo_url ? (
    <img className="tab-avatar" src={user.photo_url} alt="" width={size} height={size} />
  ) : (
    <span className="tab-avatar tab-avatar-letter" style={{ width: size, height: size }}>
      {letter}
    </span>
  )
}

// Плавающая нижняя панель: Расписание / Другое / Профиль; активная вкладка — подложка
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const item = (id: Tab, label: string, icon: React.ReactNode) => (
    <button type="button" className="tab" aria-current={tab === id} onClick={() => onTab(id)}>
      {icon}
      <span>{label}</span>
    </button>
  )
  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {item('schedule', 'Расписание', <CalendarIcon />)}
        {item('more', 'Другое', <MoreIcon />)}
        {item('profile', 'Профиль', <Avatar size={26} />)}
      </div>
    </nav>
  )
}
