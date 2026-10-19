import { useEffect, useLayoutEffect, useRef } from 'react'

const FAST_MS = 4_000
const IDLE_MS = 15_000
const IDLE_AFTER_MS = 3 * 60_000

// Опрос раз в 4 с, пока приложение на экране; после 3 минут без касаний — раз в 15 с
// (бережём бесплатные лимиты Cloudflare). Ошибки сети молча пропускаем — следующий раз повторит.
export function usePolling(tick: () => Promise<void>, active: boolean) {
  const tickRef = useRef(tick)
  useLayoutEffect(() => {
    tickRef.current = tick
  })

  useEffect(() => {
    if (!active) return
    let stopped = false
    let running = false
    let timer = 0
    let lastActivity = Date.now()
    const activity = () => {
      lastActivity = Date.now()
    }
    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, ms)
    }
    const run = async () => {
      if (stopped || running) return
      running = true
      if (document.visibilityState === 'visible') await tickRef.current().catch(() => {})
      running = false
      if (!stopped) schedule(Date.now() - lastActivity > IDLE_AFTER_MS ? IDLE_MS : FAST_MS)
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      activity()
      schedule(0)
    }
    schedule(FAST_MS)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}
