import { useCallback, useEffect, useRef, useState } from 'react'

// Короткое сообщение под списком, само пропадает через 4 с
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
