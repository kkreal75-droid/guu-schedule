import { useEffect, useLayoutEffect, useState } from 'react'
import type { ThemeMode } from './prefs'
import { inTelegram, supports, tg } from './telegram'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

// «Системная» тема = тема Telegram (а вне Telegram — тема ОС).
export const systemScheme = (): 'light' | 'dark' =>
  inTelegram ? tg!.colorScheme : darkQuery.matches ? 'dark' : 'light'

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const scheme = mode === 'system' ? systemScheme() : mode
  root.dataset.theme = scheme
  root.style.colorScheme = scheme
  // Цвета Telegram берём, когда схема совпадает с его текущей — так сохраняется
  // фирменный акцент и фон пользователя. Если принудительно выбрана другая схема,
  // используем свою палитру (см. index.css).
  root.toggleAttribute('data-tg', inTelegram && tg!.colorScheme === scheme)

  if (supports('6.1')) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    try {
      tg!.setHeaderColor(bg)
      tg!.setBackgroundColor(bg)
    } catch {
      // цвет в неожиданном формате — оставим шапку Telegram как есть
    }
  }
}

export function useTheme(mode: ThemeMode) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    darkQuery.addEventListener('change', bump)
    tg?.onEvent('themeChanged', bump)
    return () => {
      darkQuery.removeEventListener('change', bump)
      tg?.offEvent('themeChanged', bump)
    }
  }, [])

  // без deps: перекрашиваемся и при смене режима, и при смене темы Telegram/ОС
  useLayoutEffect(() => applyTheme(mode))
}
