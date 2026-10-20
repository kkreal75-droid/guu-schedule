import { useEffect, useMemo, useState } from 'react'
import type { GroupInfo, GroupsIndex } from '../../shared/groups'
import { Segmented } from '../components/Segmented'
import { loadGroups, loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { CloseIcon, SearchIcon } from '../icons'
import type { Prefs, Role } from '../prefs'
import { haptic } from '../telegram'
import { STEPS, type Choice, type Option, type Selection, type Step, type StepKey, type Value } from './Onboarding'

// «Профиль → Параметры аккаунта» (этап 7.8): «Я студент / Я преподаватель», под ним выпадающие списки
// Форма → Уровень → Курс → Институт → Направление → Программа → Группа (те же шаги, что в онбординге:
// следующий список — из того, что осталось после предыдущих; один вариант выбирается сам) и «Сохранить».
// У преподавателя — ФИО с поиском.

const LABELS: Record<StepKey, string> = {
  form: 'Форма',
  level: 'Уровень',
  course: 'Курс',
  institute: 'Институт',
  direction: 'Направление',
  program: 'Программа',
  group: 'Группа',
}

const ROLES: { value: Role; label: string }[] = [
  { value: 'student', label: 'Я студент' },
  { value: 'teacher', label: 'Я преподаватель' },
]

type Field = { step: Step; options: Option[]; value: Value | undefined }

// списки до первого невыбранного (дальше выбирать рано)
function fields(index: GroupsIndex, sel: Selection): { list: Field[]; group: GroupInfo | null } {
  let pool = index.groups
  const list: Field[] = []
  for (const step of STEPS) {
    const options = step.options(pool, index)
    const picked = sel[step.key]
    const value = picked !== undefined && options.some((o) => o.value === picked) ? picked : options.length === 1 ? options[0].value : undefined
    list.push({ step, options, value })
    if (value === undefined) return { list, group: null }
    pool = pool.filter((g) => step.value(g) === value)
  }
  return { list, group: pool[0] ?? null }
}

const selectionOf = (g: GroupInfo): Selection => Object.fromEntries(STEPS.map((s) => [s.key, s.value(g)])) as Selection

const optionLabel = (key: StepKey, o: Option) => (key === 'course' ? `${o.label} курс` : o.label)

type Props = {
  prefs: Prefs
  onSave: (choice: Choice) => Promise<void>
  onSearch: () => void // «Найти группу поиском» — онбординг с поиском
}

export function AccountForm({ prefs, onSave, onSearch }: Props) {
  const [role, setRole] = useState<Role>(prefs.role)
  const [index, setIndex] = useState<GroupsIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const [sel, setSel] = useState<Selection>({})
  const [teacher, setTeacher] = useState<{ id: string; name: string } | null>(
    prefs.teacher ? { id: prefs.teacher, name: prefs.teacherName ?? 'Преподаватель' } : null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    loadGroups().then(
      (idx) => {
        setIndex(idx)
        const mine = idx.groups.find((g) => g.id === prefs.group)
        if (mine) setSel(selectionOf(mine))
      },
      () => setFailed(true),
    )
  }, [prefs.group])

  const form = useMemo(() => (index ? fields(index, sel) : null), [index, sel])

  // выбор в списке: всё после него сбрасываем — дальнейшие варианты от него зависят
  const pick = (key: StepKey, raw: string) => {
    haptic()
    const step = STEPS.find((s) => s.key === key)!
    const value: Value = key === 'course' ? Number(raw) : raw
    setSel((s) => {
      const next: Selection = {}
      for (const st of STEPS) {
        if (st === step) break
        if (s[st.key] !== undefined) next[st.key] = s[st.key]
      }
      return { ...next, [key]: value }
    })
  }

  const choice: Choice | null =
    role === 'student'
      ? form?.group
        ? { role: 'student', group: form.group.id }
        : null
      : teacher
        ? { role: 'teacher', teacher: teacher.id, name: teacher.name }
        : null
  const changed =
    choice !== null &&
    (choice.role !== prefs.role || (choice.role === 'student' ? choice.group !== prefs.group : choice.teacher !== prefs.teacher))

  const save = async () => {
    if (!choice || saving) return
    haptic('light')
    setSaving(true)
    setError(false)
    try {
      await onSave(choice)
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <section className="section">
      <h3 className="section-title">Параметры аккаунта</h3>
      <div className="section-body account">
        <Segmented label="Кто я" value={role} options={ROLES} onChange={setRole} />

        {role === 'student' &&
          (failed ? (
            <p className="account-note">Не получилось загрузить список групп. Проверь интернет.</p>
          ) : !form ? (
            <p className="account-note">Загружаю группы…</p>
          ) : (
            form.list.map(({ step, options, value }) => (
              <label key={step.key} className="account-field">
                <span>{LABELS[step.key]}</span>
                <select
                  className="account-select"
                  value={value === undefined ? '' : String(value)}
                  onChange={(e) => pick(step.key, e.target.value)}
                  disabled={options.length < 2 && value !== undefined}
                >
                  {value === undefined && (
                    <option value="" disabled>
                      Выбери…
                    </option>
                  )}
                  {options.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {optionLabel(step.key, o)}
                    </option>
                  ))}
                </select>
              </label>
            ))
          ))}

        {role === 'teacher' && <TeacherField value={teacher} onChange={setTeacher} />}

        {error && <p className="account-note form-error">Не получилось сохранить. Проверь интернет и попробуй ещё раз.</p>}
        <button type="button" className="button-primary account-save" disabled={!changed || saving} onClick={save}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {role === 'student' && (
          <button type="button" className="account-link" onClick={() => (haptic(), onSearch())}>
            Знаю свою группу — найти поиском
          </button>
        )}
      </div>
    </section>
  )
}

// ФИО преподавателя: выбранный — строкой с крестиком, иначе поиск по фамилии (teachers.json)
function TeacherField({ value, onChange }: { value: { id: string; name: string } | null; onChange: (t: { id: string; name: string } | null) => void }) {
  const [list, setList] = useState<TeacherInfo[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!value) loadTeachers().then((d) => setList(d.teachers), () => setList([]))
  }, [value])
  const found = useMemo(() => (list && query.trim().length >= 2 ? searchTeachers(list, query, 6) : []), [list, query])

  if (value) {
    return (
      <div className="account-field">
        <span>ФИО</span>
        <div className="account-select account-picked">
          <span>{value.name}</span>
          <button type="button" className="icon-btn" aria-label="Выбрать другого" onClick={() => (haptic(), onChange(null))}>
            <CloseIcon />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="account-field">
      <span>ФИО</span>
      <label className="account-select account-search">
        <SearchIcon />
        <input type="search" value={query} placeholder="Фамилия, например Денисова" onChange={(e) => setQuery(e.target.value)} aria-label="Фамилия преподавателя" />
      </label>
      {!list && query.trim().length >= 2 && <p className="account-note">Загружаю…</p>}
      {list && query.trim().length >= 2 && !found.length && <p className="account-note">Не нашёл такую фамилию в расписании ГУУ.</p>}
      {found.length > 0 && (
        <div className="account-results">
          {found.map((t) => (
            <button key={t.id} type="button" className="account-result" onClick={() => (haptic(), onChange({ id: t.id, name: t.name }))}>
              <span className="account-result-name">{t.name}</span>
              <span className="account-result-sub">{t.subjects.slice(0, 2).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
