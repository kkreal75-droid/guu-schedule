import { useEffect, useState } from 'react'
import { BottomAction } from '../components/BottomAction'
import { Row } from '../components/Row'
import { haptic, supports, tg } from '../telegram'
import { t } from '../i18n'

// «Сервисы → Установить приложение»: иконка на домашнем экране (Telegram 8.0+: addToHomeScreen), кнопка внизу,
// совет про закреплённый чат отдельной строкой
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
  const canAdd = can && status !== 'unsupported' && status !== 'added'

  return (
    <div className="page-fill">
      <h1 className="page-title">{t('На домашний экран')}</h1>
      <p className="page-lead">{t('Иконка расписания рядом с остальными приложениями. Открывается одним касанием, без поиска бота в чатах.')}</p>
      {status === 'added' && <p className="callout install-note">{t('✅ Уже на домашнем экране')}</p>}
      {!can || status === 'unsupported' ? (
        <p className="callout install-note">
          {can ? t('На этом устройстве Telegram не умеет добавлять иконку.') : t('Нужна свежая версия Telegram — обнови приложение и открой этот экран снова.')}
        </p>
      ) : null}
      <div className="list">
        <Row emoji="📌" title={t('Ещё можно закрепить чат с ботом')} sub={t('вверху списка чатов Telegram')} />
      </div>
      {canAdd && (
        <BottomAction>
          <button type="button" className="button-primary" onClick={add}>
            {t('Добавить на домашний экран')}
          </button>
        </BottomAction>
      )}
    </div>
  )
}
