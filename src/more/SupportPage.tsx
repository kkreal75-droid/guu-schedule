import { useState } from 'react'
import { botAvailable, botError, callBot } from '../api'
import { BottomAction } from '../components/BottomAction'
import { BOT_USERNAME } from '../config'
import { haptic, openTelegramLink } from '../telegram'
import { t } from '../i18n'

// «Сервисы → Написать в поддержку»: текст уходит автору приложения в бот, ответ придёт в чат с ботом.
// Поле — серым блоком, «Отправить» — внизу экрана.
export function SupportPage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!botAvailable()) return <p className="lead">{t('Открой расписание в Telegram — написать можно только оттуда.')}</p>

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
      setError(botError(err, t('Не получилось отправить. Попробуй ещё раз.')))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="page-fill">
        <div className="empty">
          <div className="empty-emoji">💌</div>
          <div className="empty-title">{t('Отправлено')}</div>
          <div className="empty-text">{t('Ответ придёт в чат с ботом. Если ты ещё не писал боту — открой его и нажми «Старт», иначе ответ не дойдёт.')}</div>
          <button type="button" className="link-btn support-again" onClick={() => setSent(false)}>
            {t('Написать ещё')}
          </button>
        </div>
        <BottomAction>
          <button type="button" className="button-primary" onClick={() => openTelegramLink(`https://t.me/${BOT_USERNAME}`)}>
            {t('Открыть чат с ботом')}
          </button>
        </BottomAction>
      </div>
    )
  }

  return (
    <div className="page-fill">
      <p className="page-lead page-lead-tight">{t('Нашёл ошибку, есть идея или вопрос? Напиши, я читаю всё. Ответ придёт в чат с ботом.')}</p>
      <textarea
        className="input textarea support-text"
        rows={7}
        maxLength={2000}
        value={text}
        placeholder={t('Например: у МБ(МП) 1-1 в четверг не та аудитория')}
        aria-label={t('Написать в поддержку')}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="form-error">{error}</p>}
      <BottomAction>
        <button type="button" className="button-primary" disabled={busy || text.trim().length < 3} onClick={send}>
          {busy ? t('Отправляю…') : t('Отправить')}
        </button>
      </BottomAction>
    </div>
  )
}
