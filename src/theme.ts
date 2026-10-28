import { useEffect, useLayoutEffect, useState } from 'react'
import type { ThemeMode } from './prefs'
import { inTelegram, supports, tg } from './telegram'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

// «Системная» тема = тема Telegram (а вне Telegram — тема ОС).
export const systemScheme = (): 'light' | 'dark' =>
  inTelegram ? tg!.colorScheme : darkQuery.matches ? 'dark' : 'light'

// У приложения свои цвета (index.css); шапку Telegram красим в верх градиента фона, фон Telegram — в цвет
// экрана, нижнюю панель — в цвет нижнего меню
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const scheme = mode === 'system' ? systemScheme() : mode
  root.dataset.theme = scheme
  if (!supports('6.1')) return
  const css = getComputedStyle(root)
  const color = (name: string) => css.getPropertyValue(name).trim()
  try {
    tg!.setHeaderColor(color('--bg-tint'))
    tg!.setBackgroundColor(color('--bg'))
    if (supports('7.10')) tg!.setBottomBarColor(color('--card'))
  } catch {
    // цвет в неожиданном формате — оставим шапку Telegram как есть
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
