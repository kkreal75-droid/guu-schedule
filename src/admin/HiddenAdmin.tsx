import { useState } from 'react'
import { Section } from '../components/Section'
import { useGroupNames } from '../data'
import { WEEKDAYS_SHORT } from '../format'
import { confirmAction, haptic } from '../telegram'
import { hideScopeTitle } from '../../shared/edits-core'
import { adminApi, adminError, type HiddenOverview, type HiddenWindow } from './api'
import { Loading, useFlash, useLoad } from './common'

// «Админ-панель → Скрытые пары»: что люди скрывают у себя («Это не моя пара»). Если одну и ту же пару скрыли
// ≥ 60% людей группы (и хотя бы двое) — она, скорее всего, не их: одним нажатием скрыть для всей группы
// (у всех, в календарях и в беседе группы). Скрытое для всей группы можно вернуть.
const pct = (share: number) => `${Math.round(share * 100)}%`

export function HiddenAdmin() {
  const { data, setData, error } = useLoad(adminApi.hidden)
  const nameOf = useGroupNames()
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()
  if (!data) return <Loading error={error ? adminError(error) : null} />

  const run = async (action: () => Promise<HiddenOverview>, done: string) => {
    setBusy(true)
    try {
      setData(await action())
      flash(done)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }
  const title = (w: { group: string; weekday: number; start: string; subject: string; kind: string | null }) =>
    `${nameOf(w.group)} · ${WEEKDAYS_SHORT[w.weekday]} ${w.start} · ${w.subject}${w.kind ? ` (${w.kind})` : ''}`
  const hide = async (w: HiddenWindow) => {
    haptic()
    const ok = await confirmAction(
      `Скрыть для всей группы ${nameOf(w.group)}: ${WEEKDAYS_SHORT[w.weekday]} ${w.start}, ${w.subject} — ${hideScopeTitle(w)}? Пара пропадёт у всех, в календарях и в сводке в беседе.`,
    )
    if (ok) await run(() => adminApi.hideForGroup(w), 'Скрыто для всей группы')
  }

  const suggestions = data.windows.filter((w) => w.suggest && !w.done)
  const rest = data.windows.filter((w) => !(w.suggest && !w.done))
  const row = (w: HiddenWindow, button: boolean) => (
    <div key={`${w.group}|${w.weekday}|${w.start}|${w.subject}|${w.kind}|${w.scope}`} className="row admin-msg">
      <div className="admin-msg-body">
        <div className="admin-msg-text">{title(w)}</div>
        <div className="admin-msg-meta">
          скрыли {w.users} из {w.members} ({pct(w.share)}) · {hideScopeTitle(w)}
          {w.done ? ' · уже скрыта для группы' : ''}
        </div>
      </div>
      {button && (
        <button type="button" className="link-btn" disabled={busy} onClick={() => hide(w)}>
          Скрыть для группы
        </button>
      )}
    </div>
  )

  return (
    <div className="page-body">
      <Section
        title={`Подсказки (${suggestions.length})`}
        footer="Пару скрыли у себя не меньше 60% людей группы (и хотя бы двое) — скорее всего, она не их. Например, язык, который стоит у всего потока в нескольких окнах."
      >
        {suggestions.length === 0 && <div className="row row-text hidden-empty">Пока нет</div>}
        {suggestions.map((w) => row(w, true))}
      </Section>

      <Section title={`Скрыто для всей группы (${data.group.length})`} footer="Видно всем: приложение, календари, inline и сводки в беседы.">
        {data.group.length === 0 && <div className="row row-text hidden-empty">Ничего</div>}
        {data.group.map((h) => (
          <div key={h.id} className="row admin-msg">
            <div className="admin-msg-body">
              <div className="admin-msg-text">{title(h)}</div>
              <div className="admin-msg-meta">{hideScopeTitle(h)}</div>
            </div>
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={async () => {
                haptic()
                if (await confirmAction('Вернуть пару всей группе?')) await run(() => adminApi.unhideForGroup(h.id), 'Возвращено')
              }}
            >
              Вернуть
            </button>
          </div>
        ))}
      </Section>

      <Section title="Что скрывают у себя" footer={`Всего: ${data.people} чел., ${data.rules} скрытых пар (вместе с «только в этот день»).`}>
        {rest.length === 0 && <div className="row row-text hidden-empty">Пока ничего</div>}
        {rest.slice(0, 50).map((w) => row(w, !w.done))}
      </Section>
      {notice}
    </div>
  )
}
