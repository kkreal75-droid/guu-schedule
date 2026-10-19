import { useCallback, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { Section } from '../components/Section'
import { BoardIcon, CalendarIcon, ChevronLeft, ChevronRight, MoreIcon, NoteIcon, SendIcon, UserIcon } from '../icons'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { adminApi, adminError } from './api'
import { useFlash } from './common'
import { Dashboard } from './Dashboard'
import { Moderation } from './Moderation'
import { ScheduleAdmin } from './ScheduleAdmin'
import { SettingsAdmin } from './SettingsAdmin'
import { BroadcastAdmin } from './BroadcastAdmin'
import { Users } from './Users'

type SectionId = 'dashboard' | 'users' | 'broadcast' | 'moderation' | 'schedule' | 'settings'
type Item = { id: SectionId; title: string; icon: ComponentType<SVGProps<SVGSVGElement>>; render: () => ReactNode }

const ITEMS: Item[] = [
  { id: 'dashboard', title: 'Дашборд', icon: MoreIcon, render: () => <Dashboard /> },
  { id: 'users', title: 'Пользователи', icon: UserIcon, render: () => <Users /> },
  { id: 'broadcast', title: 'Рассылка', icon: SendIcon, render: () => <BroadcastAdmin /> },
  { id: 'moderation', title: 'Модерация доски', icon: BoardIcon, render: () => <Moderation /> },
  { id: 'schedule', title: 'Расписание', icon: CalendarIcon, render: () => <ScheduleAdmin /> },
  { id: 'settings', title: 'Настройки', icon: NoteIcon, render: () => <SettingsAdmin /> },
]

// «Ещё → Админ-панель» — только у владельца (кнопку показывает приложение, права проверяет бот)
export function AdminPage({ onExit }: { onExit: () => void }) {
  const [open, setOpen] = useState<SectionId | null>(null)
  const [flash, notice] = useFlash()
  const back = useCallback(() => {
    setOpen(null)
    window.scrollTo(0, 0)
  }, [])
  useBackButton(open ? back : null)

  const item = ITEMS.find((i) => i.id === open)
  const exportCsv = async () => {
    haptic()
    try {
      await adminApi.exportCsv()
      flash('Файл отправлен вам в чат с ботом')
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="screen more admin">
      <header className="page-head">
        <button type="button" className="page-back" onClick={item ? back : onExit} aria-label="Назад">
          <ChevronLeft /> {item ? 'Админ-панель' : 'Ещё'}
        </button>
        <h2 className="page-title">{item ? item.title : 'Админ-панель'}</h2>
      </header>
      {item ? (
        item.render()
      ) : (
        <div className="page-body">
          <Section>
            {ITEMS.map((i) => (
              <button
                key={i.id}
                type="button"
                className="row row-btn row-nav"
                onClick={() => {
                  haptic()
                  setOpen(i.id)
                  window.scrollTo(0, 0)
                }}
              >
                <span className="row-icon">
                  <i.icon />
                </span>
                <span className="row-label">{i.title}</span>
                <ChevronRight className="row-chevron" />
              </button>
            ))}
          </Section>
          <button type="button" className="button-secondary" onClick={exportCsv}>
            Экспорт CSV
          </button>
          {notice}
        </div>
      )}
    </div>
  )
}
