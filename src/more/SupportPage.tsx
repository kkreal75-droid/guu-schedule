import { useState } from 'react'
import { ApiError, botAvailable, callBot } from '../api'
import { BOT_USERNAME } from '../config'
import { haptic, openTelegramLink } from '../telegram'

// «Другое → Написать в поддержку»: текст уходит автору приложения в бот, ответ придёт в чат с ботом
export function SupportPage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!botAvailable()) return <p className="lead">Открой расписание в Telegram — написать можно только оттуда.</p>

  const send = async () => {
    if (busy || text.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      await callBot('/support', { text: text.trim() })
      haptic('light')
      setSent(true)
      setText('')
    } catch (err) {
      setError(err instanceof ApiError && /[а-яё]/i.test(err.code) ? err.code : 'Не получилось отправить. Попробуй ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="install">
        <div className="install-hero">
          <span className="install-emoji">💌</span>
          <h2 className="install-title">Отправлено</h2>
          <p className="install-text">Ответ придёт в чат с ботом. Если ты ещё не писал боту — открой его и нажми «Старт», иначе ответ не дойдёт.</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => openTelegramLink(`https://t.me/${BOT_USERNAME}`)}>
          Открыть чат с ботом
        </button>
        <button type="button" className="button-secondary" onClick={() => setSent(false)}>
          Написать ещё
        </button>
      </div>
    )
  }

  return (
    <div className="form support">
      <p className="support-hint">Нашёл ошибку в расписании, есть идея или вопрос? Напиши — я читаю всё. Ответ придёт в чат с ботом.</p>
      <textarea
        className="input textarea"
        rows={7}
        maxLength={2000}
        value={text}
        placeholder="Например: у МБ(МП) 1-1 в четверг не та аудитория"
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="form-error">{error}</p>}
      <button type="button" className="button-primary" disabled={busy || text.trim().length < 3} onClick={send}>
        {busy ? 'Отправляю…' : 'Отправить'}
      </button>
    </div>
  )
}
