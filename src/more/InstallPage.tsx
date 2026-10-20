import { useEffect, useState } from 'react'
import { haptic, supports, tg } from '../telegram'

// «Другое → Установить приложение»: ярлык на домашнем экране (Telegram 8.0+: addToHomeScreen)
type Status = 'unsupported' | 'unknown' | 'added' | 'missed' | null

export function InstallPage() {
  const can = supports('8.0')
  const [status, setStatus] = useState<Status>(null)
  useEffect(() => {
    if (!can) return
    const check = () => tg!.checkHomeScreenStatus((s) => setStatus(s))
    check()
    tg!.onEvent('homeScreenAdded', check)
    return () => tg!.offEvent('homeScreenAdded', check)
  }, [can])

  const add = () => {
    haptic('light')
    tg!.addToHomeScreen()
  }

  return (
    <div className="install">
      <div className="install-hero">
        <span className="install-emoji">📲</span>
        <h2 className="install-title">На домашний экран</h2>
        <p className="install-text">Иконка расписания рядом с остальными приложениями — открывается одним касанием, без поиска бота в чатах.</p>
      </div>
      {status === 'added' ? (
        <p className="install-done">✅ Уже на домашнем экране</p>
      ) : can && status !== 'unsupported' ? (
        <button type="button" className="button-primary" onClick={add}>
          Добавить на домашний экран
        </button>
      ) : (
        <p className="install-text">
          {can ? 'На этом устройстве Telegram не умеет добавлять иконку.' : 'Нужна свежая версия Telegram — обнови приложение и открой этот экран снова.'} Можно
          закрепить чат с ботом вверху списка чатов — так расписание тоже всегда под рукой.
        </p>
      )}
    </div>
  )
}
