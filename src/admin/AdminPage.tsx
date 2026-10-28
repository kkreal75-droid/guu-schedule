import { useCallback, useState, type ReactNode } from 'react'
import { Row } from '../components/Row'
import { Section } from '../components/Section'
import { resetIntro } from '../intro'
import { confirmAction, haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { adminApi, adminError } from './api'
import { useFlash } from './common'
import { Dashboard } from './Dashboard'
import { ReviewsAdmin } from './ReviewsAdmin'
import { HiddenAdmin } from './HiddenAdmin'
import { TranslationsAdmin } from './TranslationsAdmin'
import { AcademicAdmin } from './AcademicAdmin'
import { PlacesAdmin } from './PlacesAdmin'
import { ScheduleAdmin } from './ScheduleAdmin'
import { SettingsAdmin } from './SettingsAdmin'
import { BroadcastAdmin } from './BroadcastAdmin'
import { Users } from './Users'

type SectionId = 'dashboard' | 'users' | 'broadcast' | 'reviews' | 'schedule' | 'hidden' | 'translations' | 'academic' | 'places' | 'settings'
type Item = { id: SectionId; title: string; emoji: string; render: () => ReactNode }

const ITEMS: Item[] = [
  { id: 'dashboard', title: 'Дашборд', emoji: '📊', render: () => <Dashboard /> },
  { id: 'users', title: 'Пользователи', emoji: '👥', render: () => <Users /> },
  { id: 'broadcast', title: 'Рассылка', emoji: '📣', render: () => <BroadcastAdmin /> },
  { id: 'reviews', title: 'Отзывы', emoji: '⭐', render: () => <ReviewsAdmin /> },
  { id: 'schedule', title: 'Расписание', emoji: '📅', render: () => <ScheduleAdmin /> },
  { id: 'hidden', title: 'Скрытые пары', emoji: '🙈', render: () => <HiddenAdmin /> },
  { id: 'translations', title: 'Переводы', emoji: '🔤', render: () => <TranslationsAdmin /> },
  { id: 'academic', title: 'Учебный график', emoji: '🗓️', render: () => <AcademicAdmin /> },
  { id: 'places', title: 'Места', emoji: '🏛', render: () => <PlacesAdmin /> },
  { id: 'settings', title: 'Настройки', emoji: '⚙️', render: () => <SettingsAdmin /> },
]

// «Сервисы → Админ-панель» — только у владельца (пункт показывает приложение, права проверяет бот).
// «Назад» — кнопкой Telegram: из раздела — к списку, из списка — к «Сервисам».
export function AdminPage() {
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

  // для проверки: знакомство (истории, «Это твоя группа?», тур) покажется снова — сразу, после перезапуска
  const resetMyIntro = async () => {
    if (!(await confirmAction('Сбросить онбординг и перезапустить приложение?'))) return
    try {
      await resetIntro()
      window.location.reload()
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="screen more admin">
      <h1 className="page-title page-title-gap">{item ? item.title : 'Админ-панель'}</h1>
      {item ? (
        item.render()
      ) : (
        <div className="page-body">
          <Section>
            {ITEMS.map((i) => (
              <Row
                key={i.id}
                emoji={i.emoji}
                title={i.title}
                chevron
                onClick={() => {
                  haptic()
                  setOpen(i.id)
                  window.scrollTo(0, 0)
                }}
              />
            ))}
          </Section>
          <button type="button" className="button-secondary" onClick={exportCsv}>
            Экспорт CSV
          </button>
          <button type="button" className="button-secondary" onClick={resetMyIntro}>
            Сбросить мой онбординг
          </button>
          {notice}
        </div>
      )}
    </div>
  )
}
