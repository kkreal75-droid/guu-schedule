import { useCallback, useEffect, useState } from 'react'
import { botAvailable } from '../api'
import { Segmented } from '../components/Segmented'
import { haptic } from '../telegram'
import { boardApi, errorText, type BoardId, type Entered, type EnterResult } from './api'
import { BoardCanvas } from './BoardCanvas'
import { BoardChat } from './BoardChat'

// «Ещё → Доска»: при первом входе — правила, дальше доски группы и общая, чат и рисовалка
export function BoardPage({ group }: { group: string }) {
  const [state, setState] = useState<EnterResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!botAvailable()) return
    boardApi
      .enter(group)
      .then(setState)
      .catch((err) => setError(errorText(err)))
    // группа нужна только при первом входе — при смене группы в профиле повторно не запрашиваем
  }, [])

  if (!botAvailable()) return <p className="lead">Откройте расписание в Telegram — доска работает только там.</p>
  if (error) return <p className="board-empty">{error}</p>
  if (!state) return <p className="board-empty">Загружаю доску…</p>

  if (!state.rules) {
    const accept = async () => {
      setAccepting(true)
      try {
        setState(await boardApi.accept(state.group))
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
  const [boardId, setBoardId] = useState<BoardId>(data.boards[0].id)
  const [mode, setMode] = useState<'chat' | 'draw'>('chat')
  const [bannedUntil, setBannedUntil] = useState(data.banned_until)
  const onBanned = useCallback((until: number | null) => setBannedUntil(until), [])
  const info = data.boards.find((b) => b.id === boardId) ?? data.boards[0]
  const props = { board: info.id, config: data.config, admin: data.admin, bannedUntil, onBanned }

  return (
    <div className="board">
      <div className="board-switches">
        {data.boards.length > 1 && (
          <Segmented
            label="Доска"
            value={boardId}
            options={data.boards.map((b) => ({ value: b.id, label: b.title }))}
            onChange={setBoardId}
          />
        )}
        <Segmented
          label="Режим"
          value={mode}
          options={[
            { value: 'chat', label: 'Чат' },
            { value: 'draw', label: 'Рисовалка' },
          ]}
          onChange={setMode}
        />
      </div>
      <p className="board-me">
        Здесь ты — <b>{info.alias}</b>
      </p>
      {mode === 'chat' ? <BoardChat key={info.id} {...props} /> : <BoardCanvas key={info.id} {...props} />}
    </div>
  )
}
