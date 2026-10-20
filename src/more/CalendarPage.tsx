import { useEffect, useState } from 'react'
import { normalizeGroup, shortName } from '../../shared/groups'
import { Section } from '../components/Section'
import { botAvailable, callBot } from '../api'
import { confirmAction, haptic, openLink } from '../telegram'

type Status = { connected: false } | { connected: true; url: string; group: string }

// «1-1» для МБ, иначе имя группы; со старых версий бота может прийти имя — понимаем и его
const short = (group: string) => shortName(normalizeGroup(group) ?? group)

export function CalendarPage({ group }: { group: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!botAvailable()) return
    callBot<Status>('/cal/status')
      .then(setStatus)
      .catch(() => setError('Не получилось связаться с ботом. Попробуйте позже.'))
  }, [])

  if (!botAvailable()) {
    return <p className="lead">Откройте расписание в Telegram — подключить календарь можно только оттуда.</p>
  }

  const run = async (action: () => Promise<Status>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
      haptic('light')
    } catch {
      setError('Не получилось. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async () => {
    if (!status) return
    if (!status.connected) return run(() => callBot<Status>('/cal/connect', { group }))
    if (await confirmAction('Отключить календарь? Старая ссылка перестанет работать, пары пропадут из календаря.')) {
      await run(() => callBot<Status>('/cal/disconnect'))
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // старые WebView без доступа к буферу — выделяем поле, чтобы скопировать вручную
      ;(document.querySelector('.cal-url') as HTMLInputElement | null)?.select()
    }
    haptic('light')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const webcal = status?.connected ? status.url.replace(/^https?:/, 'webcal:') : ''

  return (
    <div className="page-body">
      <p className="lead">Пары появятся в календаре телефона и будут обновляться сами — без бота и приложения.</p>

      <Section>
        <label className="row row-switch">
          <span className="row-label">Подключить</span>
          <input
            type="checkbox"
            className="switch"
            checked={Boolean(status?.connected)}
            disabled={!status || busy}
            onChange={toggle}
          />
        </label>
        {status?.connected && (
          <div className="row">
            <span>Группа</span>
            <span className="row-value">{short(status.group)}</span>
          </div>
        )}
      </Section>

      {error && <p className="form-error">{error}</p>}

      {status?.connected && (
        <>
          {normalizeGroup(status.group) !== group && (
            <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => callBot<Status>('/cal/connect', { group }))}>
              Переключить на {short(group)} (как в профиле)
            </button>
          )}
          {/* Telegram открывает только http(s): страница бота сама передаст webcal:// Календарю */}
          <button type="button" className="button-primary" onClick={() => openLink(status.url.replace(/\.ics$/, '/apple'))}>
            Apple Календарь
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => openLink(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`)}
          >
            Google Календарь
          </button>
          <button type="button" className="button-secondary" onClick={() => copy(status.url)}>
            {copied ? 'Скопировано ✓' : 'Скопировать ссылку'}
          </button>
          <input className="cal-url" readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} />

          <Section title="Как добавить">
            <div className="row row-text">
              iPhone — «Apple Календарь» → «Подписаться». Android — «Google Календарь» → «Добавить». В других
              приложениях добавьте календарь по ссылке.
            </div>
          </Section>
          <p className="section-footer">
            Google и iPhone обновляют подписки сами: Google — бывает, что и раз в сутки. Срочные изменения смотрите в
            боте.
          </p>
        </>
      )}
    </div>
  )
}
