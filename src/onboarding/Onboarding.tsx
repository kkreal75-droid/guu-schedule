// Регистрация: «Ты учишься или преподаёшь?» → студент: 7 шагов (форма → уровень → курс → институт →
// направление → программа → группа) → «Всё готово» → «Сохранить»; преподаватель: поиск по фамилии → подтверждение.
// Шаги с одним вариантом выбираются сами; тап по строке сразу ведёт дальше; выбранное — строкой «Очная ·
// Бакалавриат · Изменить» над заголовком; сверху на каждом шаге — поле «Знаю свою группу» (поиск по всем группам).
// Полоска прогресса: 9 делений (роль, 7 шагов, готово). Части знакомства (этап 7.1) и «Профиль».
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GroupInfo, GroupsIndex } from '../../shared/groups'
import { Row } from '../components/Row'
import { loadGroups, loadTeacher, type TeacherInfo } from '../data'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupSearch } from './GroupSearch'
import { Progress } from './Stories'
import { Icon } from '../icons'
import { TeacherPicker } from './TeacherPicker'
import { t, tn } from '../i18n'
import { instituteShort, trDirection, trInstitute, trProgram, trSubject, trTeacher } from '../guu'

export type Choice = { role: 'student'; group: string } | { role: 'teacher'; teacher: string; name: string }

type Props = {
  reason?: string // почему снова: «группы больше нет в расписании»
  startSearch?: boolean // «Профиль → Знаю свою группу» — сразу поиск
  onDone: (choice: Choice) => Promise<void>
  onCancel?: () => void // «Назад» с первого экрана (к знакомству или в профиль)
}

// ---------- шаги студента ----------

export type StepKey = 'form' | 'level' | 'course' | 'institute' | 'direction' | 'program' | 'group'
export type Value = string | number
export type Option = { value: Value; label: string; sub?: string }

export type Step = {
  key: StepKey
  title: () => string // на языке интерфейса
  value: (g: GroupInfo) => Value
  options: (pool: GroupInfo[], index: GroupsIndex) => Option[]
  chip: (v: Value, index: GroupsIndex) => string
}

const LEVEL_ORDER = ['bachelor', 'master', 'postgrad']

// форма и уровень обучения на языке интерфейса
export const formTitle = (form: GroupInfo['form']) => (form === 'ozfo' ? t('Очно-заочная') : t('Очная'))
export const levelTitle = (level: GroupInfo['level']) =>
  level === 'master' ? t('Магистратура') : level === 'postgrad' ? t('Аспирантура') : t('Бакалавриат')

const uniq = <T,>(items: T[]) => [...new Set(items)]
// «Название (уточнение)» → ['Название', 'уточнение']
export const splitTitle = (text: string): [string, string | undefined] => {
  const m = text.match(/^(.+?)\s*\(([^()]+)\)$/)
  return m ? [m[1], m[2]] : [text, undefined]
}
const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'ru')

export const STEPS: Step[] = [
  {
    key: 'form',
    title: () => t('Форма обучения'),
    value: (g) => g.form,
    options: (pool) =>
      uniq(pool.map((g) => g.form))
        .sort()
        .map((v) => ({ value: v, label: formTitle(v) })),
    chip: (v) => formTitle(v as GroupInfo['form']),
  },
  {
    key: 'level',
    title: () => t('Уровень образования'),
    value: (g) => g.level,
    options: (pool) =>
      uniq(pool.map((g) => g.level))
        .sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))
        .map((v) => ({ value: v, label: levelTitle(v) })),
    chip: (v) => levelTitle(v as GroupInfo['level']),
  },
  {
    key: 'course',
    title: () => t('На каком ты курсе?'),
    value: (g) => g.course,
    options: (pool) =>
      uniq(pool.map((g) => g.course))
        .sort((a, b) => a - b)
        .map((v) => ({ value: v, label: t('{n} курс', { n: v }) })),
    chip: (v) => t('{n} курс', { n: v }),
  },
  {
    key: 'institute',
    title: () => t('Твой институт'),
    value: (g) => g.institute,
    // крупно — сокращение, которое знают студенты, подписью — полное название
    options: (pool, index) =>
      uniq(pool.map((g) => g.institute))
        .map((v) => ({ value: v, label: instituteShort(v), sub: index.institutes[v] ? trInstitute(v, index.institutes[v]) : undefined }))
        .sort(byLabel),
    chip: (v) => instituteShort(String(v)),
  },
  {
    key: 'direction',
    title: () => t('Направление'),
    value: (g) => g.direction,
    options: (pool) =>
      uniq(pool.map((g) => g.direction))
        .map((v) => ({ value: v, label: trDirection(v) }))
        .sort(byLabel),
    chip: (v) => trDirection(String(v)),
  },
  {
    key: 'program',
    title: () => t('Образовательная программа'),
    value: (g) => g.program,
    // «Международный бизнес (международная программа)» — название и подпись
    options: (pool) =>
      uniq(pool.map((g) => g.program))
        .map((v) => {
          const [label, sub] = splitTitle(trProgram(v))
          return { value: v, label, sub }
        })
        .sort(byLabel),
    chip: (v) => splitTitle(trProgram(String(v)))[0],
  },
  {
    key: 'group',
    title: () => t('Твоя группа'),
    value: (g) => g.id,
    options: (pool) =>
      [...pool]
        .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name, 'ru'))
        .map((g) => ({ value: g.id, label: g.name })),
    chip: (v, index) => index.groups.find((g) => g.id === v)?.name ?? String(v),
  },
]

export type Selection = Partial<Record<StepKey, Value>>
type Crumb = { step: Step; value: Value; auto: boolean }

// Проходим шаги по выбранному; шаг с одним вариантом выбирается сам
function walk(index: GroupsIndex, sel: Selection) {
  let pool = index.groups
  const crumbs: Crumb[] = []
  for (const step of STEPS) {
    const options = step.options(pool, index)
    const picked = sel[step.key]
    const chosen = picked !== undefined && options.some((o) => o.value === picked)
    const value = chosen ? picked : options.length === 1 ? options[0].value : undefined
    if (value === undefined) return { crumbs, current: step, options, group: null as GroupInfo | null }
    crumbs.push({ step, value, auto: !chosen })
    pool = pool.filter((g) => step.value(g) === value)
  }
  return { crumbs, current: null, options: [], group: pool[0] ?? null }
}

// ---------- общий вид ----------

const STAGES = 9 // деления полоски прогресса: роль, 7 шагов, готово

// Экран знакомства и регистрации: полоска прогресса, содержимое сверху (или по центру — center), одна кнопка внизу
export function Shell({
  progress,
  top,
  children,
  foot,
  center = false,
}: {
  progress?: number // 0…1
  top?: ReactNode
  children: ReactNode
  foot?: ReactNode
  center?: boolean
}) {
  return (
    <div className="ob">
      {progress !== undefined && <Progress value={progress} />}
      {top}
      <div className={center ? 'ob-center' : 'ob-body'}>{children}</div>
      {foot && <div className="bottom-action">{foot}</div>}
    </div>
  )
}

// Что это за группа: форма, уровень, курс; институт и направление; программа (знакомство — «Это твоя группа?»)
export function GroupFacts({ group }: { group: GroupInfo }) {
  const [program, programSub] = splitTitle(trProgram(group.program))
  return (
    <div className="list">
      <Row title={`${formTitle(group.form)}, ${levelTitle(group.level).toLowerCase()}, ${t('{n} курс', { n: group.course })}`} />
      <Row title={`${instituteShort(group.institute)}, ${trDirection(group.direction)}`} />
      <Row title={program} sub={programSub} />
    </div>
  )
}

// Сводка выбора таблицей: «Форма — Очная», «Уровень — Бакалавриат»… (регистрация — «Всё готово»)
function ChoiceSummary({ group }: { group: GroupInfo }) {
  const rows: [string, string][] = [
    [t('Форма'), formTitle(group.form)],
    [t('Уровень'), levelTitle(group.level)],
    [t('Курс'), String(group.course)],
    [t('Институт'), instituteShort(group.institute)],
    [t('Направление'), trDirection(group.direction)],
    [t('Программа'), splitTitle(trProgram(group.program))[0]],
  ]
  return (
    <div className="list">
      {rows.map(([title, value]) => (
        <Row key={title} title={title} value={value} />
      ))}
    </div>
  )
}

// Пар в неделю у преподавателя: в среднем по неделям, где у него есть пары (по файлу преподавателя)
function usePairsPerWeek(teacher: string | null): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    setCount(null)
    if (!teacher) return
    loadTeacher(teacher).then(
      (file) => {
        const weeks = new Set(file.lessons.flatMap((l) => l.weeks))
        const total = file.lessons.reduce((n, l) => n + l.weeks.length, 0)
        setCount(weeks.size ? Math.round(total / weeks.size) : 0)
      },
      () => {},
    )
  }, [teacher])
  return count
}

// ---------- регистрация ----------

type Screen = 'role' | 'student' | 'search' | 'teacher'
type Picked = { choice: Choice; name: string; from: Screen; group?: GroupInfo; teacher?: TeacherInfo }

export function Onboarding({ reason, startSearch, onDone, onCancel }: Props) {
  const [screen, setScreen] = useState<Screen>(startSearch ? 'search' : 'role')
  const [sel, setSel] = useState<Selection>({})
  const [index, setIndex] = useState<GroupsIndex | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null) // выбрано — «Всё готово» / «Ваше расписание»
  const [saving, setSaving] = useState(false)
  const pairsPerWeek = usePairsPerWeek(picked?.choice.role === 'teacher' ? picked.choice.teacher : null)

  const fetchIndex = useCallback(() => {
    setError(false)
    loadGroups().then(setIndex, () => setError(true))
  }, [])
  useEffect(fetchIndex, [fetchIndex])

  const walked = useMemo(() => (index ? walk(index, sel) : null), [index, sel])

  // все шаги пройдены — группа определилась
  useEffect(() => {
    if (screen === 'student' && walked?.group && !picked) {
      const group = walked.group
      setPicked({ choice: { role: 'student', group: group.id }, name: group.name, from: 'student', group })
    }
  }, [screen, walked?.group, picked])

  // выбор на шаге: всё после него сбрасываем — дальнейшие варианты от него зависят
  const keepBefore = (s: Selection, key: StepKey): Selection => {
    const next: Selection = {}
    for (const step of STEPS) {
      if (step.key === key) break
      if (s[step.key] !== undefined) next[step.key] = s[step.key]
    }
    return next
  }
  const pick = (key: StepKey, value: Value) => {
    haptic()
    setSel((s) => ({ ...keepBefore(s, key), [key]: value }))
  }
  const unpick = (key: StepKey) => {
    haptic()
    setPicked(null)
    setSel((s) => keepBefore(s, key))
  }

  const save = async () => {
    if (!picked || saving) return
    haptic('light')
    setSaving(true)
    try {
      await onDone(picked.choice)
    } catch {
      setSaving(false)
      setError(true)
    }
  }

  // «Назад» (кнопка Telegram, «Изменить»): со сводки — к выбору; на шагах — снять последний ручной выбор;
  // с первого экрана — onCancel
  const back = () => {
    haptic()
    if (picked) {
      const from = picked.from
      setPicked(null)
      if (from === 'student') {
        const last = walked?.crumbs.filter((c) => !c.auto).at(-1)
        if (last) setSel((s) => keepBefore(s, last.step.key))
        else setScreen('role')
      }
      return
    }
    if (screen === 'search') return startSearch ? onCancel?.() : setScreen(index && walked?.crumbs.length ? 'student' : 'role')
    if (screen === 'teacher') return setScreen('role')
    if (screen === 'student') {
      const last = walked?.crumbs.filter((c) => !c.auto).at(-1)
      if (last) return unpick(last.step.key)
      return setScreen('role')
    }
    onCancel?.()
  }
  const canBack = Boolean(picked) || screen !== 'role' || Boolean(onCancel)
  useBackButton(canBack && !saving ? back : null)

  const saveButton = (
    <button type="button" className="button-primary" onClick={save} disabled={saving}>
      {saving ? t('Сохраняю…') : t('Сохранить')}
    </button>
  )
  const saveError = error && <p className="callout ob-reason">{t('Не получилось сохранить. Проверь интернет и попробуй ещё раз.')}</p>

  // ---------- «Всё готово» / «Ваше расписание» ----------
  if (picked) {
    if (picked.choice.role === 'teacher') {
      const subjects = picked.teacher?.subjects ?? []
      return (
        <Shell progress={1} foot={saveButton}>
          {saveError}
          <p className="ob-overline ob-overline-red">{t('Ваше расписание')}</p>
          <h1 className="ob-name">{trTeacher(picked.name)}</h1>
          <div className="list">
            <Row title={t('Пар в неделю')} value={pairsPerWeek ?? '…'} />
            {subjects.length > 0 && (
              <Row title={tn(subjects.length, 'Дисциплина|Дисциплины|Дисциплин')} sub={subjects.map(trSubject).join(', ')} />
            )}
          </div>
          <p className="ob-note ob-note-2">{t('Расписание собрано по файлам ГУУ, осталось сохранить.')}</p>
        </Shell>
      )
    }
    return (
      <Shell progress={1} foot={saveButton}>
        {saveError}
        <p className="ob-overline ob-overline-red">{t('Всё готово')}</p>
        <h1 className="ob-name" lang="ru">
          {picked.name}
        </h1>
        {picked.group && <ChoiceSummary group={picked.group} />}
        <p className="ob-note ob-note-2">{t('Расписание уже готово, осталось сохранить.')}</p>
      </Shell>
    )
  }

  if (screen === 'role') {
    return (
      <Shell progress={1 / STAGES} foot={null}>
        <h1 className="ob-title ob-title-m">{t('Ты учишься или преподаёшь?')}</h1>
        <p className="ob-text ob-text-s">{t('Покажем пары твоей группы или твои занятия.')}</p>
        {reason && <p className="callout ob-reason">{reason}</p>}
        <div className="list">
          <Row icon="cap" title={t('Учусь')} sub={t('Расписание своей группы')} chevron onClick={() => (haptic(), setScreen('student'))} />
          <Row icon="board" title={t('Преподаю')} sub={t('Расписание по своей фамилии')} chevron onClick={() => (haptic(), setScreen('teacher'))} />
        </div>
        <p className="ob-note">{t('Это займёт меньше минуты. Поменять можно в профиле.')}</p>
      </Shell>
    )
  }

  if (screen === 'teacher') {
    return (
      <Shell progress={4 / STAGES}>
        <h1 className="ob-top-title">{t('Ваша фамилия')}</h1>
        <p className="ob-top-text">{t('Найдём ваше расписание по файлам ГУУ.')}</p>
        <TeacherPicker
          onPick={(teacher) => (haptic(), setPicked({ choice: { role: 'teacher', teacher: teacher.id, name: teacher.name }, name: teacher.name, from: 'teacher', teacher }))}
        />
      </Shell>
    )
  }

  if (!index || !walked) {
    return (
      <Shell progress={2 / STAGES}>
        {error ? (
          <>
            <p className="ob-text">{t('Не получилось загрузить список групп. Проверь интернет.')}</p>
            <button type="button" className="link-btn" onClick={fetchIndex}>
              {t('Повторить')}
            </button>
          </>
        ) : (
          <p className="ob-text">{t('Загружаю группы…')}</p>
        )}
      </Shell>
    )
  }

  if (screen === 'search') {
    return (
      <Shell>
        <h1 className="ob-top-title">{t('Найти группу')}</h1>
        <GroupSearch
          groups={index.groups}
          onPick={(group) => (haptic(), setPicked({ choice: { role: 'student', group: group.id }, name: group.name, from: 'search', group }))}
        />
      </Shell>
    )
  }

  // ---------- шаги студента ----------
  const { crumbs, current, options } = walked
  if (!current) return null // группа определилась — сейчас покажется «Всё готово» (см. эффект выше)
  const stepNo = STEPS.indexOf(current) + 1
  // последние три выбора; когда выбрана программа, направление в ней уже есть
  const hasProgram = crumbs.some((c) => c.step.key === 'program')
  const chain = crumbs
    .filter((c) => !(hasProgram && c.step.key === 'direction'))
    .slice(-3)
    .map(({ step, value }) => step.chip(value, index))
  return (
    <Shell
      progress={(1 + stepNo) / STAGES}
      top={
        <button type="button" className="search ob-search" onClick={() => (haptic(), setScreen('search'))}>
          <Icon name="search" size={18} strokeWidth={2} className="search-icon" />
          <span>{t('Знаю свою группу, найти по названию')}</span>
        </button>
      }
    >
      <div key={current.key} className="ob-story">
        {chain.length > 0 && (
          <p className="ob-chain">
            {chain.join(' · ')} ·{' '}
            <button type="button" className="link-btn" onClick={back}>
              {t('Изменить')}
            </button>
          </p>
        )}
        <h1 className="ob-title ob-title-s">{current.title()}</h1>
        <div className="list">
          {options.map((o) => (
            <Row
              key={String(o.value)}
              title={o.label}
              sub={o.sub}
              lang={current.key === 'group' || current.key === 'institute' ? 'ru' : undefined}
              chevron
              onClick={() => pick(current.key, o.value)}
            />
          ))}
        </div>
      </div>
    </Shell>
  )
}
