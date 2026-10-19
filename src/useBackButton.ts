import { useEffect } from 'react'
import { supports, tg } from './telegram'

// Системная кнопка «Назад» в шапке Telegram. Страницы бывают вложенными (Ещё → Админ-панель →
// Пользователи → карточка), поэтому обработчики — стопкой: срабатывает только верхний.
const stack: (() => void)[] = []
const onClick = () => stack.at(-1)?.()
let attached = false

function sync() {
  if (!supports('6.1')) return
  if (stack.length) {
    if (!attached) tg!.BackButton.onClick(onClick)
    attached = true
    tg!.BackButton.show()
  } else {
    tg!.BackButton.hide()
    if (attached) tg!.BackButton.offClick(onClick)
    attached = false
  }
}

export function useBackButton(onBack: (() => void) | null) {
  useEffect(() => {
    if (!onBack) return
    stack.push(onBack)
    sync()
    return () => {
      const i = stack.lastIndexOf(onBack)
      if (i >= 0) stack.splice(i, 1)
      sync()
    }
  }, [onBack])
}
