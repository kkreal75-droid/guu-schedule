import { useEffect } from 'react'
import { supports, tg } from './telegram'

// Системная кнопка «Назад» в шапке Telegram, пока открыта вложенная страница
export function useBackButton(onBack: (() => void) | null) {
  useEffect(() => {
    if (!onBack || !supports('6.1')) return
    tg!.BackButton.onClick(onBack)
    tg!.BackButton.show()
    return () => {
      tg!.BackButton.offClick(onBack)
      tg!.BackButton.hide()
    }
  }, [onBack])
}
