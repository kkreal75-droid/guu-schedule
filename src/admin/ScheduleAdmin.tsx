import { useState } from 'react'
import { Segmented } from '../components/Segmented'
import { Section } from '../components/Section'
import { WEEKDAYS_FULL, formatDate, formatStamp } from '../format'
import { dayFromIso, inSemester, isoFromDay, lessonsOn, moscowNow, weekOf, weekdayOf } from '../schedule'
import { confirmAction, haptic, openLink } from '../telegram'
import { adminApi, adminError, shortGroup, type Run } from './api'
import { Loading, useFlash, useLoad } from './common'

const GROUPS = ['МБ(МП) 1-1', 'МБ(МП) 1-2']
type GroupChoice = 'МБ(МП) 1-1' | 'МБ(МП) 1-2' | 'both'

const EVENTS: Record<string, string> = { schedule: 'по часам', workflow_dispatch: 'вручную', push: 'обновление кода' }

function runStatus(run: Run) {
  if (run.status !== 'completed') return '⏳ идёт'
  return run.conclusion === 'success' ? '✅ готово' : run.conclusion === 'skipped' ? '— пропущен' : `❌ ${run.conclusion ?? 'ошибка'}`
}

// пары группы (или обеих) в выбранный день — для выбора, какую отменить или пометить
function pairsOn(iso: string, choice: GroupChoice): { start: string; label: string }[] {
  const day = dayFromIso(iso)
  const week = weekOf(day)
  if (!inSemester(week)) return []
  const byStart = new Map<string, string[]>()
  for (const group of choice === 'both' ? GROUPS : [choice]) {
    for (const l of lessonsOn(group, week, weekdayOf(day))) {
      byStart.set(l.start, [...(byStart.get(l.start) ?? []), `${l.subject}${choice === 'both' ? ` (${shortGroup(group)})` : ''}`])
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, subjects]) => ({ start, label: `${start} · ${subjects.join(' / ')}` }))
}

export function ScheduleAdmin() {
  const { data, setData } = useLoad(adminApi.schedule)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [group, setGroup] = useState<GroupChoice>('МБ(МП) 1-1')
  const [date, setDate] = useState(() => isoFromDay(moscowNow().day))
  const [kind, setKind] = useState<'cancel' | 'note'>('cancel')
  const [start, setStart] = useState<string>('')
  const [text, setText] = useState('')
  const [flash, notice] = useFlash()

  if (!data) return <Loading />
  const pairs = pairsOn(date, group)
  const day = dayFromIso(date)

  const updateNow = async () => {
    setBusy(true)
    try {
      await adminApi.updateNow(force)
      haptic('light')
      flash('Запустил. GitHub проверит guu.ru и при изменениях пересоберёт сайт — обычно 1–3 минуты.')
      setTimeout(() => adminApi.schedule().then(setData, () => {}), 4000)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    setBusy(true)
    try {
      const res = await adminApi.editAdd({
        groups: group === 'both' ? GROUPS : [group],
        date,
        start: start || null,
        kind,
        text,
      })
      setData({ ...data, edits: res.edits })
      setText('')
      haptic('light')
      flash('Правка добавлена — в приложении, боте и календаре появится в течение минуты')
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    if (!(await confirmAction('Удалить правку?'))) return
    try {
      const res = await adminApi.editDelete(id)
      setData({ ...data, edits: res.edits })
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="page-body">
      <Section title="Автообновление">
        <div className="row">
          <span>Обновлено</span>
          <span className="row-value">{data.updated_at ? formatStamp(data.updated_at) : '—'}</span>
        </div>
        <div className="row">
          <span>Файл ГУУ</span>
          <span className="row-value row-value-wrap">{data.source_file ?? '—'}</span>
        </div>
        <div className="row">
          <span>Пар в файле · SHA-256</span>
          <span className="row-value">
            {data.lessons} · {data.source_sha256?.slice(0, 10) ?? '—'}
          </span>
        </div>
      </Section>

      <Section title="Последние запуски на GitHub">
        {data.github.runs === null && <div className="row row-text">Не получилось спросить GitHub: {data.github.error}</div>}
        {data.github.runs?.map((run) => (
          <button key={run.id} type="button" className="row row-btn" onClick={() => openLink(run.html_url)}>
            <span>{runStatus(run)}</span>
            <span className="row-value">
              {EVENTS[run.event] ?? run.event} · {new Date(run.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </button>
        ))}
      </Section>

      <label className="row-check-line">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Пересобрать, даже если файл на guu.ru не менялся
      </label>
      <button type="button" className="button-primary" disabled={busy || !data.github.token} onClick={updateNow}>
        Обновить сейчас
      </button>
      {!data.github.token && <p className="section-footer">Чтобы кнопка заработала, нужен секрет GITHUB_TOKEN.</p>}
      {notice}

      <Section title="Ручная правка" footer="Автообновление правки не трогает. Видны в приложении, inline, беседах, /today и календаре.">
        <div className="form">
          <Segmented
            label="Группа"
            value={group}
            options={[
              { value: 'МБ(МП) 1-1', label: '1-1' },
              { value: 'МБ(МП) 1-2', label: '1-2' },
              { value: 'both', label: 'Обе' },
            ]}
            onChange={(g) => {
              setGroup(g)
              setStart('')
            }}
          />
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => {
              if (!e.target.value) return
              setDate(e.target.value)
              setStart('')
            }}
          />
          <p className="form-hint">
            {WEEKDAYS_FULL[weekdayOf(day)]}, {formatDate(day)} · пар: {pairs.length}
          </p>
          <Segmented
            label="Что сделать"
            value={kind}
            options={[
              { value: 'cancel', label: 'Отменить пару' },
              { value: 'note', label: 'Пометка' },
            ]}
            onChange={setKind}
          />
          <select className="input" value={start} onChange={(e) => setStart(e.target.value)}>
            <option value="">{kind === 'note' ? 'Ко всему дню' : 'Выберите пару'}</option>
            {pairs.map((p) => (
              <option key={p.start} value={p.start}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder={kind === 'cancel' ? 'Причина (необязательно)' : 'Текст пометки'}
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="button-primary" disabled={busy || (kind === 'cancel' && !start) || (kind === 'note' && !text.trim())} onClick={add}>
            Добавить
          </button>
        </div>
      </Section>

      <Section title={`Правки (${data.edits.length})`}>
        {data.edits.length === 0 && <div className="row row-text">Правок нет</div>}
        {data.edits.map((e) => (
          <div key={e.id} className="row admin-msg">
            <div className="admin-msg-body">
              <div className="admin-msg-meta">
                {formatDate(dayFromIso(e.date))} · {shortGroup(e.group)} · {e.start ?? 'весь день'}
              </div>
              <div className="admin-msg-text">
                {e.kind === 'cancel' ? `❌ Пара отменена${e.text ? `: ${e.text}` : ''}` : `📌 ${e.text}`}
              </div>
            </div>
            <button type="button" className="link-btn danger" onClick={() => remove(e.id)}>
              Удалить
            </button>
          </div>
        ))}
      </Section>
    </div>
  )
}
