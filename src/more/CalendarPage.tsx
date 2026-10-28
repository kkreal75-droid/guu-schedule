import { useEffect, useState } from 'react'
import { normalizeGroup, shortName } from '../../shared/groups'
import { Row } from '../components/Row'
import { Section } from '../components/Section'
import { botAvailable, callBot } from '../api'
import { confirmAction, haptic, openLink } from '../telegram'
import { t } from '../i18n'

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
      .catch(() => setError(t('Не получилось связаться с ботом. Попробуйте позже.')))
  }, [])

  if (!botAvailable()) {
    return <p className="lead">{t('Откройте расписание в Telegram — подключить календарь можно только оттуда.')}</p>
  }

  const run = async (action: () => Promise<Status>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
      haptic('light')
    } catch {
      setError(t('Не получилось. Попробуйте ещё раз.'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async () => {
    if (!status) return
    if (!status.connected) return run(() => callBot<Status>('/cal/connect', { group }))
    if (await confirmAction(t('Отключить календарь? Старая ссылка перестанет работать, пары пропадут из календаря.'))) {
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
      <p className="page-lead">{t('Пары появятся в календаре телефона и будут обновляться сами, даже без Telegram.')}</p>

      <Section footer={status?.connected ? undefined : t('Работает с Apple и Google Календарём. Отключить можно здесь же.')}>
        <label className="row row-switch">
          <span className="row-emoji" aria-hidden="true">
            📅
          </span>
          <span className="row-label">
            <span className="row-text">{t('Подключить')}</span>
          </span>
          <input type="checkbox" className="switch" checked={Boolean(status?.connected)} disabled={!status || busy} onChange={toggle} />
        </label>
        {status?.connected && <Row title={t('Группа')} value={short(status.group)} />}
      </Section>

      {error && <p className="form-error">{error}</p>}

      {status?.connected && (
        <>
          {normalizeGroup(status.group) !== group && (
            <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => callBot<Status>('/cal/connect', { group }))}>
              {t('Переключить на {group} (как в профиле)', { group: short(group) })}
            </button>
          )}
          <Section title={t('Добавить в календарь')} footer={t('Google и iPhone обновляют подписки сами: Google — бывает, что и раз в сутки. Срочные изменения смотрите в боте.')}>
            {/* Telegram открывает только http(s): страница бота сама передаст webcal:// Календарю */}
            <Row emoji="🍏" title={t('Apple Календарь')} sub={t('iPhone: «Подписаться»')} value="↗" onClick={() => openLink(status.url.replace(/\.ics$/, '/apple'))} />
            <Row
              emoji="🗓️"
              title={t('Google Календарь')}
              sub={t('Android: «Добавить»')}
              value="↗"
              onClick={() => openLink(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`)}
            />
            <Row emoji="🔗" title={copied ? t('Скопировано ✓') : t('Скопировать ссылку')} sub={t('Для других приложений календаря')} onClick={() => copy(status.url)} />
          </Section>
          <input className="input cal-url" readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
  )
}
