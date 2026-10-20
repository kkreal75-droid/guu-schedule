import { useEffect, useState } from 'react'
import { normalizeWeeks, sectionEmoji, weeksProblem, type SportData, type SportSection, type SportSession } from '../../shared/sport-core'
import { Section } from '../components/Section'
import { WEEKDAYS_SHORT } from '../format'
import { ChevronLeft, ChevronRight } from '../icons'
import { guessPlace, loadPlaces, type Place } from '../places'
import { confirmAction, haptic } from '../telegram'
import { adminApi, adminError } from './api'
import { Loading, useFlash, useLoad } from './common'
import { readTable, sportRows, type SportRow } from './table-import'

// «Админ-панель → Спорт»: секции и занятия (на guu.ru машиночитаемого расписания секций нет).
// Импорт CSV / xlsx: столбцы Секция, День, Начало, Конец, Преподаватель, Место, Недели — занятия секций
// из файла заменяются целиком.

const TIME = /^\d{1,2}[:.]\d{2}$/
const rowProblem = (r: SportRow) =>
  r.section.trim().length < 2
    ? 'нет названия секции'
    : !TIME.test(r.start) || !TIME.test(r.end)
      ? 'время начала и конца'
      : weeksProblem(normalizeWeeks(r.weeks))

export function SportAdmin() {
  const { data, setData, error } = useLoad(adminApi.sport)
  const [open, setOpen] = useState<number | 'new' | null>(null)
  const [flash, notice] = useFlash()
  const [importing, setImporting] = useState<{ rows: SportRow[]; problems: string[]; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!data) return <Loading error={error ? adminError(error) : null} />
  const update = (next: SportData) => setData(next)

  if (open !== null) {
    const section = open === 'new' ? null : (data.sections.find((s) => s.id === open) ?? null)
    return (
      <SectionEditor
        section={section}
        sessions={section ? data.sessions.filter((s) => s.section_id === section.id) : []}
        onBack={() => setOpen(null)}
        onSaved={(next, name) => {
          update(next)
          // новая секция — сразу к её занятиям
          if (open === 'new') setOpen(next.sections.find((s) => s.name === name)?.id ?? null)
        }}
        onDeleted={(next) => {
          update(next)
          setOpen(null)
        }}
      />
    )
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const { rows, problems } = sportRows(await readTable(file))
      const bad = rows.flatMap((r, i) => {
        const p = rowProblem(r)
        return p ? [`строка ${i + 2}: ${p}`] : []
      })
      setImporting({ rows, problems: [...problems, ...bad], name: file.name })
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Не получилось прочитать файл')
    }
  }

  const runImport = async () => {
    if (!importing) return
    setBusy(true)
    try {
      const res = await adminApi.sportImport(importing.rows)
      update(res)
      setImporting(null)
      haptic('light')
      flash(`Импортировано занятий: ${res.imported}`)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-body">
      {notice}
      <Section
        title={`Секции · ${data.sections.length}`}
        footer="Видны во вкладке «Спорт». Пока секций нет, там написано «Расписание секций скоро появится»."
      >
        {data.sections.map((s) => (
          <button key={s.id} type="button" className="row row-btn row-nav" onClick={() => (haptic(), setOpen(s.id))}>
            <span className="row-icon">{sectionEmoji(s)}</span>
            <span className="row-label">{s.name}</span>
            <span className="row-value">{data.sessions.filter((x) => x.section_id === s.id).length} в неделю</span>
            <ChevronRight className="row-chevron" />
          </button>
        ))}
        <button type="button" className="row row-btn row-link" onClick={() => (haptic(), setOpen('new'))}>
          <span>+ Добавить секцию</span>
        </button>
      </Section>

      <Section
        title="Импорт из таблицы"
        footer="CSV или xlsx, первая строка — заголовки: Секция; День; Начало; Конец; Преподаватель; Место; Недели. День — «Пн» или «понедельник», недели — пусто (каждую), «чёт», «нечёт» или «1-8,10». Занятия секций из файла заменяются целиком, остальные секции не трогаются."
      >
        <label className="row row-btn row-link">
          <span>Выбрать файл…</span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv"
            className="visually-hidden"
            onChange={(e) => {
              void pickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </Section>

      {importing && (
        <Section title={importing.name}>
          <div className="row row-text">
            Занятий: {importing.rows.length}, секций: {new Set(importing.rows.map((r) => r.section.trim())).size}
          </div>
          {importing.problems.slice(0, 20).map((p) => (
            <div key={p} className="row row-text form-error">
              {p}
            </div>
          ))}
          <div className="row row-chips">
            <button type="button" className="chip chip-accent" disabled={busy || importing.problems.length > 0 || !importing.rows.length} onClick={runImport}>
              Импортировать
            </button>
            <button type="button" className="chip" onClick={() => setImporting(null)}>
              Отмена
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}

// ---------- секция и её занятия ----------

type Props = {
  section: SportSection | null
  sessions: SportSession[]
  onBack: () => void
  onSaved: (data: SportData, name: string) => void
  onDeleted: (data: SportData) => void
}

function SectionEditor({ section, sessions, onBack, onSaved, onDeleted }: Props) {
  const [form, setForm] = useState({
    name: section?.name ?? '',
    emoji: section?.emoji ?? '',
    teacher: section?.teacher ?? '',
    place: section?.place ?? '',
    place_id: section?.place_id ?? '',
    about: section?.about ?? '',
    sort: String(section?.sort ?? 0),
  })
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const [places, setPlaces] = useState<Place[]>([])
  useEffect(() => void loadPlaces().then(setPlaces, () => {}), [])
  const guessed = form.place_id ? null : guessPlace(places, form.place)

  const run = async (action: () => Promise<SportData>, done: (d: SportData) => void, ok: string) => {
    setBusy(true)
    try {
      done(await action())
      haptic('light')
      flash(ok)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(
      () => adminApi.sportSectionSave({ id: section?.id, ...form, sort: Number(form.sort) || 0 }),
      (d) => onSaved(d, form.name.trim()),
      'Сохранено',
    )
  const remove = async () => {
    if (!section || !(await confirmAction(`Удалить секцию «${section.name}» со всеми занятиями?`))) return
    await run(() => adminApi.sportSectionDelete(section.id), onDeleted, 'Удалено')
  }

  return (
    <div className="page-body">
      <button type="button" className="page-back admin-sub-back" onClick={onBack}>
        <ChevronLeft /> Все секции
      </button>
      {notice}
      <Section title={section ? section.name : 'Новая секция'}>
        <div className="form">
          <label className="field">
            <span>Название</span>
            <input className="input" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Волейбол" />
          </label>
          <label className="field">
            <span>Эмодзи (необязательно — подберётся по названию)</span>
            <input className="input" value={form.emoji} maxLength={8} onChange={(e) => set({ emoji: e.target.value })} placeholder={sectionEmoji({ name: form.name, emoji: null })} />
          </label>
          <label className="field">
            <span>Преподаватель</span>
            <input className="input" value={form.teacher} maxLength={80} onChange={(e) => set({ teacher: e.target.value })} />
          </label>
          <label className="field">
            <span>Место</span>
            <input className="input" value={form.place} maxLength={80} onChange={(e) => set({ place: e.target.value })} placeholder="Спортивный комплекс, зал №2" />
          </label>
          <label className="field">
            <span>Место на карте («Корпуса ГУУ»)</span>
            <select className="input" value={form.place_id} onChange={(e) => set({ place_id: e.target.value })}>
              <option value="">{guessed ? `По названию: ${guessed.name}` : 'Нет'}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>О секции</span>
            <textarea className="input textarea" rows={3} value={form.about} maxLength={400} onChange={(e) => set({ about: e.target.value })} />
          </label>
          <label className="field">
            <span>Порядок в списке (меньше — выше)</span>
            <input className="input" inputMode="numeric" value={form.sort} onChange={(e) => set({ sort: e.target.value.replace(/[^\d-]/g, '') })} />
          </label>
          <div className="row-chips">
            <button type="button" className="chip chip-accent" disabled={busy || form.name.trim().length < 2} onClick={save}>
              Сохранить
            </button>
            {section && (
              <button type="button" className="chip chip-danger" disabled={busy} onClick={remove}>
                Удалить секцию
              </button>
            )}
          </div>
        </div>
      </Section>

      {section && (
        <Section title={`Занятия · ${sessions.length} в неделю`}>
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} sectionId={section.id} onData={(d) => onSaved(d, section.name)} />
          ))}
          <SessionRow sectionId={section.id} onData={(d) => onSaved(d, section.name)} />
        </Section>
      )}
    </div>
  )
}

// одно занятие: день, время, недели, преподаватель и место (пусто — как у секции)
function SessionRow({ session, sectionId, onData }: { session?: SportSession; sectionId: number; onData: (d: SportData) => void }) {
  const [form, setForm] = useState({
    weekday: session?.weekday ?? 0,
    start: session?.start ?? '',
    end: session?.end ?? '',
    weeks: session?.weeks === 'even' ? 'чёт' : session?.weeks === 'odd' ? 'нечёт' : (session?.weeks ?? ''),
    teacher: session?.teacher ?? '',
    place: session?.place ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const act = async (action: () => Promise<SportData>) => {
    setBusy(true)
    setError(null)
    try {
      onData(await action())
      haptic('light')
      if (!session) setForm({ weekday: form.weekday, start: '', end: '', weeks: '', teacher: '', place: '' })
    } catch (err) {
      setError(adminError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="form sport-session-form">
      <div className="row-chips">
        {WEEKDAYS_SHORT.map((d, i) => (
          <button key={d} type="button" className="chip" aria-pressed={form.weekday === i} onClick={() => set({ weekday: i })}>
            {d}
          </button>
        ))}
      </div>
      <div className="sport-times">
        <input className="input" type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} aria-label="Начало" />
        <input className="input" type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} aria-label="Конец" />
        <input className="input" value={form.weeks} placeholder="недели" onChange={(e) => set({ weeks: e.target.value })} aria-label="Недели" />
      </div>
      <input className="input" value={form.teacher} placeholder="Преподаватель (пусто — как у секции)" onChange={(e) => set({ teacher: e.target.value })} />
      <input className="input" value={form.place} placeholder="Место (пусто — как у секции)" onChange={(e) => set({ place: e.target.value })} />
      {error && <p className="form-error">{error}</p>}
      <div className="row-chips">
        <button
          type="button"
          className="chip chip-accent"
          disabled={busy || !form.start || !form.end}
          onClick={() => act(() => adminApi.sportSessionSave({ id: session?.id, section_id: sectionId, ...form }))}
        >
          {session ? 'Сохранить' : '+ Добавить занятие'}
        </button>
        {session && (
          <button type="button" className="chip chip-danger" disabled={busy} onClick={() => act(() => adminApi.sportSessionDelete(session.id))}>
            Удалить
          </button>
        )}
      </div>
    </div>
  )
}
