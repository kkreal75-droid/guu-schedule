import { useCallback, useEffect, useRef, useState } from 'react'

// Короткое сообщение под лентой/холстом, само пропадает через 4 с
export function useNotice(): [string | null, (text: string) => void] {
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])
  return [notice, flash]
}

// бан «навсегда» бот хранит как дату в 9999 году
const FOREVER_AFTER_MS = 5 * 365 * 86_400_000

export function BanNotice({ until }: { until: number }) {
  const forever = until - Date.now() > FOREVER_AFTER_MS
  const date = new Date(until).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <p className="board-banned">
      {forever
        ? 'Тебе запрещено писать и рисовать на доске. Читать можно.'
        : `Писать и рисовать на доске можно будет с ${date}. Пока — только читать.`}
    </p>
  )
}
