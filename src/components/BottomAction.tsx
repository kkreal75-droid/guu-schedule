import { useEffect, type ReactNode } from 'react'

let shown = 0

// Кнопка внизу экрана на белой подложке (отзыв, поддержка, бот в беседе, установка): пока она на экране,
// нижнее меню скрыто
export function BottomAction({ children }: { children: ReactNode }) {
  useEffect(() => {
    shown++
    document.body.dataset.noTabbar = ''
    return () => {
      shown--
      if (!shown) delete document.body.dataset.noTabbar
    }
  }, [])
  return <div className="bottom-action">{children}</div>
}
