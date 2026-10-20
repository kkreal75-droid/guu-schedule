import { useCallback, useEffect, useState } from 'react'
import { botAvailable } from '../api'
import { haptic } from '../telegram'
import { boardApi, errorText, type Entered, type EnterResult } from './api'
import { BoardChat } from './BoardChat'

// «Другое → Подслушано»: анонимный чат на весь ГУУ; при первом входе — правила
export function BoardPage() {
  const [state, setState] = useState<EnterResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!botAvailable()) return
    boardApi
      .enter()
      .then(setState)
      .catch((err) => setError(errorText(err)))
  }, [])

  if (!botAvailable()) return <p className="lead">Откройте расписание в Telegram — чат работает только там.</p>
  if (error) return <p className="board-empty">{error}</p>
  if (!state) return <p className="board-empty">Загружаю…</p>

  if (!state.rules) {
    const accept = async () => {
      setAccepting(true)
      try {
        setState(await boardApi.accept())
        haptic('light')
      } catch (err) {
        setError(errorText(err))
      } finally {
        setAccepting(false)
      }
    }
    return (
      <div className="page-body board-rules">
        <div className="board-rules-card">
          <p className="board-rules-emoji" aria-hidden>
            🦦
          </p>
          <p className="board-rules-text">Для других ты аноним.</p>
        </div>
        <button type="button" className="button-primary" disabled={accepting} onClick={accept}>
          Понятно
        </button>
      </div>
    )
  }

  return <Board data={state} />
}

function Board({ data }: { data: Entered }) {
  const [bannedUntil, setBannedUntil] = useState(data.banned_until)
  const onBanned = useCallback((until: number | null) => setBannedUntil(until), [])

  return (
    <div className="board">
      <p className="board-me">
        Здесь ты — <b>{data.alias}</b>
      </p>
      <BoardChat board={data.board} config={data.config} admin={data.admin} bannedUntil={bannedUntil} onBanned={onBanned} />
    </div>
  )
}
