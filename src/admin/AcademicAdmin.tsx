import { useMemo, useState } from 'react'
import {
  KIND_TITLES, SOURCE_TITLES, defaultPeriods, formatIsoLong, periodsProblem, scopeKey, type CalendarEdit,
  type ComputedCalendar, type PeriodDraft, type PeriodKind,
} from '../../shared/calendar-core'
import { FORM_TITLES, LEVEL_TITLES, type GroupInfo, type GroupsIndex } from '../../shared/groups'
import { forgetCalendar, loadComputedCalendar } from '../academic'
import { Section } from '../components/Section'
import { loadGroups } from '../data'
import { ChevronRight } from '../icons'
import { useBackButton } from '../useBackButton'
import { confirmAction, haptic } from '../telegram'
import { adminApi, adminError } from './api'
import { Loading, useFlash, useLoad } from './common'

// «Админ-панель → Учебный график» (этап 8.3): периоды учёбы, сессий, практик и каникул по уровню / форме / курсу
// (или для одной программы). Без правки — типовой график (shared/calendar-core.ts) и учёба осени по расписанию.
// «Сверено с документом ГУУ» — в приложении источник «по документу ГУУ».

type Data = { edits: CalendarEdit[]; index: GroupsIndex; computed: ComputedCalendar | null }

async function loadAll(): Promise<Data> {
  const [{ edits }, index, computed] = await Promise.all([adminApi.academic(), loadGroups(), loadComputedCalendar()])
  return { edits, index, computed }
}

type Scope = { key: string; level: GroupInfo['level']; form: GroupInfo['form']; course: number; groups: GroupInfo[] }

const scopeTitle = (s: Pick<Scope, 'level' | 'form' | 'course'>) =>
  `${LEVEL_TITLES[s.level]} · ${s.form === 'ozfo' ? 'ОЗФО' : FORM_TITLES[s.form].toLowerCase()} · ${s.course} курс`

export function AcademicAdmin() {
  const { data, setData, error } = useLoad(loadAll)
  const [open, setOpen] = useState<{ base: Scope; program: string | null } | null>(null)

  const scopes = useMemo(() => {
    if (!data) return []
    const map = new Map<string, Scope>()
    for (const g of data.index.groups) {
      const key = scopeKey(g.level, g.form, g.course)
      const s = map.get(key) ?? { key, level: g.level, form: g.form, course: g.course, groups: [] }
      s.groups.push(g)
      map.set(key, s)
    }
    return [...map.values()].sort(
      (a, b) => ['bachelor', 'master', 'postgrad'].indexOf(a.level) - ['bachelor', 'master', 'postgrad'].indexOf(b.level) || a.form.localeCompare(b.form) || a.course - b.course,
    )
  }, [data])

  if (!data) return <Loading error={error ? adminError(error) : null} />

  const onEdits = (edits: CalendarEdit[]) => {
    forgetCalendar()
    setData({ ...data, edits })
  }

  if (open) {
    return (
      <ScopeEditor
        key={`${open.base.key}|${open.program ?? ''}`}
        base={open.base}
        program={open.program}
        data={data}
        onProgram={(program) => setOpen({ base: open.base, program })}
        onBack={() => setOpen(null)}
        onEdits={onEdits}
      />
    )
  }

  const editOf = (key: string) => data.edits.find((e) => e.scope === key)
  return (
    <div className="page-body">
      <Section
        title="Курсы"
        footer="Без правки — типовой график ГУУ 2026/27, учёба осени — по файлам расписания. Нажми на курс, чтобы поправить периоды (для всего курса или одной программы)."
      >
        {scopes.map((s) => {
          const edit = editOf(s.key)
          const programs = data.edits.filter((e) => e.scope.startsWith(`${s.key}|`)).length
          return (
            <button key={s.key} type="button" className="row row-btn row-nav" onClick={() => (haptic(), setOpen({ base: s, program: null }))}>
              <span className="row-label">
                {scopeTitle(s)}
                {edit && <span className="badge-file badge-todo">{edit.doc ? 'по документу' : 'правка'}</span>}
                {programs > 0 && <span className="badge-file badge-todo">программ: {programs}</span>}
              </span>
              <span className="row-value">{s.groups.length} гр.</span>
              <ChevronRight className="row-chevron" />
            </button>
          )
        })}
      </Section>
      <p className="section-footer">
        Источники в приложении: «{SOURCE_TITLES.doc}», «{SOURCE_TITLES.schedule}», «{SOURCE_TITLES.estimate}». Праздничные
        дни — по ТК РФ и постановлениям о переносе выходных, их здесь не правят.
      </p>
    </div>
  )
}

// ---------- периоды одного курса (или программы) ----------

const KINDS = Object.keys(KIND_TITLES) as PeriodKind[]

function ScopeEditor({ base, program, data, onProgram, onBack, onEdits }: {
  base: Scope
  program: string | null
  data: Data
  onProgram: (program: string | null) => void
  onBack: () => void
  onEdits: (edits: CalendarEdit[]) => void
}) {
  useBackButton(onBack) // «Назад» Telegram — к списку курсов
  const key = scopeKey(base.level, base.form, base.course, program)
  const own = data.edits.find((e) => e.scope === key) ?? null
  const course = program ? (data.edits.find((e) => e.scope === base.key) ?? null) : null
  const defaults = defaultPeriods(base.level, base.form, base.course, data.computed)
  const startWith: PeriodDraft[] = own?.periods ?? course?.periods ?? defaults.map(({ kind, start, end, title }) => ({ kind, start, end, title }))
  const [rows, setRows] = useState<PeriodDraft[]>(startWith)
  const [doc, setDoc] = useState(own?.doc ?? false)
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()
  const programs = [...new Set(base.groups.map((g) => g.program))].sort((a, b) => a.localeCompare(b, 'ru'))
  const problem = periodsProblem(rows)

  const set = (i: number, patch: Partial<PeriodDraft>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const save = async () => {
    setBusy(true)
    try {
      onEdits((await adminApi.academicSave(key, rows, doc)).edits)
      haptic('light')
      flash('Сохранено — в приложении через минуту')
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    if (!(await confirmAction(program ? 'Убрать правку программы? Будет как у всего курса.' : 'Вернуть типовой график ГУУ?'))) return
    setBusy(true)
    try {
      onEdits((await adminApi.academicReset(key)).edits)
      onBack()
    } catch (err) {
      flash(adminError(err))
      setBusy(false)
    }
  }

  return (
    <div className="page-body">
      {notice}
      <Section title={scopeTitle(base)} footer={`Групп: ${base.groups.length}. Правка программы важнее правки курса.`}>
        <label className="field row row-form">
          <span>Для кого</span>
          <select className="input" value={program ?? ''} onChange={(e) => onProgram(e.target.value || null)}>
            <option value="">Весь курс</option>
            {programs.map((p) => (
              <option key={p} value={p}>
                {p}
                {data.edits.some((e) => e.scope === scopeKey(base.level, base.form, base.course, p)) ? ' · правка' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="row row-text">
          Сейчас: {own ? (own.doc ? 'правка, сверено с документом ГУУ' : 'правка (уточняется)') : course ? 'как у всего курса (правка)' : 'типовой график'}
        </div>
      </Section>

      {!own && !course && (
        <Section title="Откуда даты сейчас">
          {defaults.map((p) => (
            <div key={p.start} className="row row-text">
              {p.title}: {formatIsoLong(p.start)} — {formatIsoLong(p.end)} · {SOURCE_TITLES[p.source]}
            </div>
          ))}
        </Section>
      )}

      <Section title="Периоды" footer="Даты включительно. Пары в беседе не приходят на каникулах; в первый день каникул бот пишет «🎉 Каникулы! Пар нет до ДД.ММ».">
        <div className="form">
          {rows.map((r, i) => (
            <div key={i} className="academic-row">
              <div className="academic-row-top">
                <select className="input" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as PeriodKind })} aria-label="Тип">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_TITLES[k]}
                    </option>
                  ))}
                </select>
                <input className="input" value={r.title} maxLength={60} placeholder="Название" onChange={(e) => set(i, { title: e.target.value })} />
              </div>
              <div className="academic-row-dates">
                <input className="input" type="date" value={r.start} onChange={(e) => set(i, { start: e.target.value })} aria-label="С" />
                <span>—</span>
                <input className="input" type="date" value={r.end} onChange={(e) => set(i, { end: e.target.value })} aria-label="По" />
                <button type="button" className="chip chip-danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="chip"
            onClick={() => setRows((rs) => [...rs, { kind: 'holidays', start: rs.at(-1)?.end ?? '2027-01-01', end: rs.at(-1)?.end ?? '2027-01-01', title: '' }])}
          >
            + Период
          </button>
          <label className="row row-switch">
            <span className="row-label">Сверено с документом ГУУ</span>
            <input type="checkbox" className="switch" checked={doc} onChange={(e) => setDoc(e.target.checked)} />
          </label>
          {problem && <p className="form-error">{problem}</p>}
          <div className="row-chips">
            <button type="button" className="chip chip-accent" disabled={busy || Boolean(problem)} onClick={save}>
              Сохранить
            </button>
            {own && (
              <button type="button" className="chip chip-danger" disabled={busy} onClick={reset}>
                {program ? 'Убрать правку программы' : 'Вернуть типовой'}
              </button>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}

