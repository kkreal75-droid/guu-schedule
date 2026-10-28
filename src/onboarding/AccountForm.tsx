import { useEffect, useMemo, useState } from 'react'
import type { GroupInfo, GroupsIndex } from '../../shared/groups'
import { Row } from '../components/Row'
import { SearchField } from '../components/SearchField'
import { Segmented } from '../components/Segmented'
import { loadGroups, loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { ChevronRight } from '../icons'
import type { Prefs, Role } from '../prefs'
import { haptic } from '../telegram'
import { STEPS, type Choice, type Option, type Selection, type Step, type StepKey, type Value } from './Onboarding'
import { t } from '../i18n'
import { trSubject, trTeacher } from '../guu'

// «Профиль → Учёба» (этап 7.8): «🎓 Учусь / 👩‍🏫 Преподаю», под ним строки «название — значение»
// Форма → Уровень → Курс → Институт → Направление → Программа → Группа (нажатие — системный список; те же шаги,
// что в онбординге: следующий список — из того, что осталось после предыдущих; один вариант выбирается сам)
// и «Сохранить». У преподавателя — ФИО с поиском.

const label = (key: StepKey) =>
  ({
    form: t('Форма'),
    level: t('Уровень'),
    course: t('Курс'),
    institute: t('Институт'),
    direction: t('Направление'),
    program: t('Программа'),
    group: t('Группа'),
  })[key]

const roles = (): { value: Role; label: string }[] => [
  { value: 'student', label: `🎓 ${t('Учусь')}` },
  { value: 'teacher', label: `👩‍🏫 ${t('Преподаю')}` },
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

const optionLabel = (_key: StepKey, o: Option) => o.label

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
    prefs.teacher ? { id: prefs.teacher, name: prefs.teacherName ?? t('Преподаватель') } : null,
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
    <section className="section account">
      <h3 className="section-title">{t('Учёба')}</h3>
      <Segmented label={t('Кто я')} value={role} options={roles()} onChange={setRole} />

      {role === 'student' &&
        (failed ? (
          <p className="lead account-note">{t('Не получилось загрузить список групп. Проверь интернет.')}</p>
        ) : !form ? (
          <p className="lead account-note">{t('Загружаю группы…')}</p>
        ) : (
          <div className="list account-list">
            {form.list.map(({ step, options, value }) => {
              const fixed = options.length < 2 && value !== undefined
              const shown = value === undefined ? t('Выбери…') : (options.find((o) => o.value === value)?.label ?? String(value))
              return (
                <label key={step.key} className="row account-row" data-fixed={fixed || undefined}>
                  <span className="row-label">
                    <span className="row-text">{label(step.key)}</span>
                  </span>
                  <span className="row-value" lang={step.key === 'group' || step.key === 'institute' ? 'ru' : undefined}>
                    {step.key === 'course' && value !== undefined ? String(value) : shown}
                  </span>
                  {!fixed && <ChevronRight className="row-chevron" />}
                  <select
                    lang={step.key === 'group' ? 'ru' : undefined}
                    className="row-select"
                    aria-label={label(step.key)}
                    value={value === undefined ? '' : String(value)}
                    onChange={(e) => pick(step.key, e.target.value)}
                    disabled={fixed}
                  >
                    {value === undefined && (
                      <option value="" disabled>
                        {t('Выбери…')}
                      </option>
                    )}
                    {options.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {optionLabel(step.key, o)}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
          </div>
        ))}

      {role === 'teacher' && <TeacherField value={teacher} onChange={setTeacher} />}

      {error && <p className="form-error account-note">{t('Не получилось сохранить. Проверь интернет и попробуй ещё раз.')}</p>}
      <button type="button" className="button-primary account-save" disabled={!changed || saving} onClick={save}>
        {saving ? t('Сохраняю…') : t('Сохранить')}
      </button>
      {role === 'student' && (
        <button type="button" className="button-secondary" onClick={() => (haptic(), onSearch())}>
          {t('Знаю свою группу — найти поиском')}
        </button>
      )}
    </section>
  )
}

// ФИО преподавателя: выбранный — строкой «Изменить», иначе поиск по фамилии (teachers.json)
function TeacherField({ value, onChange }: { value: { id: string; name: string } | null; onChange: (t: { id: string; name: string } | null) => void }) {
  const [list, setList] = useState<TeacherInfo[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!value) loadTeachers().then((d) => setList(d.teachers), () => setList([]))
  }, [value])
  const found = useMemo(() => (list && query.trim().length >= 2 ? searchTeachers(list, query, 6) : []), [list, query])

  if (value) {
    return (
      <div className="list account-list">
        <Row title={t('ФИО')} value={trTeacher(value.name)} />
        <Row title={<span className="row-link">{t('Выбрать другого')}</span>} onClick={() => (haptic(), onChange(null))} />
      </div>
    )
  }
  return (
    <div className="account-teacher">
      <SearchField value={query} onChange={setQuery} placeholder={t('Фамилия, например Денисова')} label={t('Фамилия преподавателя')} />
      {!list && query.trim().length >= 2 && <p className="gsearch-empty">{t('Загружаю…')}</p>}
      {list && query.trim().length >= 2 && !found.length && <p className="gsearch-empty">{t('Не нашёл такую фамилию в расписании ГУУ.')}</p>}
      {found.length > 0 && (
        <div className="list">
          {found.map((teacher) => (
            <Row
              key={teacher.id}
              title={trTeacher(teacher.name)}
              sub={<span className="gsearch-sub">{teacher.subjects.slice(0, 2).map(trSubject).join(', ')}</span>}
              chevron
              onClick={() => (haptic(), onChange({ id: teacher.id, name: teacher.name }))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
