// Онбординг: при первом входе (новый пользователь без группы) и из «Профиль → Сменить группу / роль».
//   приветствие → «Кто ты» → студент: форма → уровень → курс → институт → программа → группа
//                           → преподаватель: поиск по фамилии
// Каждый шаг — крупные карточки, тап сразу ведёт дальше; шаги с одним вариантом пропускаются;
// на любом шаге — «Знаю свою группу» (поиск по всем группам). Ни слова об оплате.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FORM_TITLES, LEVEL_TITLES, type GroupInfo, type GroupsIndex } from '../../shared/groups'
import { loadGroups } from '../data'
import { ChevronRight, CloseIcon } from '../icons'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupSearch } from './GroupSearch'
import { TeacherPicker } from './TeacherPicker'

export type Choice = { role: 'student'; group: string } | { role: 'teacher'; teacher: string; name: string }

type Props = {
  reason?: string // почему снова: «группы больше нет в расписании»
  onDone: (choice: Choice) => Promise<void>
  onCancel?: () => void // есть — это «Сменить группу / роль» из профиля
}

// ---------- шаги студента ----------

type StepKey = 'form' | 'level' | 'course' | 'institute' | 'program' | 'group'
type Value = string | number
type Option = { value: Value; label: string; sub?: string }

type Step = {
  key: StepKey
  title: string
  tiles?: 'small' | 'wide' // плитки вместо карточек: курс — маленькие, группы — по две в ряд
  value: (g: GroupInfo) => Value
  options: (pool: GroupInfo[], index: GroupsIndex) => Option[]
  chip: (v: Value, index: GroupsIndex) => string
}

const LEVEL_ORDER = ['bachelor', 'master', 'postgrad']

const uniq = <T,>(items: T[]) => [...new Set(items)]

const STEPS: Step[] = [
  {
    key: 'form',
    title: 'Форма обучения',
    value: (g) => g.form,
    options: (pool) =>
      uniq(pool.map((g) => g.form))
        .sort()
        .map((v) => ({ value: v, label: FORM_TITLES[v] })),
    chip: (v) => FORM_TITLES[v as GroupInfo['form']],
  },
  {
    key: 'level',
    title: 'Уровень образования',
    value: (g) => g.level,
    options: (pool) =>
      uniq(pool.map((g) => g.level))
        .sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))
        .map((v) => ({ value: v, label: LEVEL_TITLES[v] })),
    chip: (v) => LEVEL_TITLES[v as GroupInfo['level']],
  },
  {
    key: 'course',
    title: 'Какой курс?',
    tiles: 'small',
    value: (g) => g.course,
    options: (pool) =>
      uniq(pool.map((g) => g.course))
        .sort((a, b) => a - b)
        .map((v) => ({ value: v, label: String(v) })),
    chip: (v) => `${v} курс`,
  },
  {
    key: 'institute',
    title: 'Твой институт',
    value: (g) => g.institute,
    options: (pool, index) =>
      uniq(pool.map((g) => g.institute))
        .map((v) => ({ value: v, label: index.institutes[v] ?? v, sub: v }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    chip: (v) => String(v),
  },
  {
    key: 'program',
    title: 'Образовательная программа',
    value: (g) => g.program,
    options: (pool) =>
      uniq(pool.map((g) => g.program))
        .map((v) => ({ value: v, label: v, sub: pool.find((g) => g.program === v)?.direction || undefined }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    chip: (v) => String(v),
  },
  {
    key: 'group',
    title: 'И наконец — группа',
    tiles: 'wide',
    value: (g) => g.id,
    options: (pool) =>
      [...pool]
        .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name, 'ru'))
        .map((g) => ({ value: g.id, label: g.name })),
    chip: (v, index) => index.groups.find((g) => g.id === v)?.name ?? String(v),
  },
]

type Selection = Partial<Record<StepKey, Value>>

// Проходим шаги по выбранному: шаг с одним вариантом выбирается сам и не показывается
function walk(index: GroupsIndex, sel: Selection) {
  let pool = index.groups
  const shown: { step: Step; value: Value }[] = []
  for (const step of STEPS) {
    const options = step.options(pool, index)
    const picked = sel[step.key]
    const value = picked !== undefined && options.some((o) => o.value === picked) ? picked : options.length === 1 ? options[0].value : undefined
    if (value === undefined) {
      // осталось шагов, где действительно есть выбор (по текущему набору групп — примерно)
      const ahead = STEPS.slice(STEPS.indexOf(step) + 1).filter((s) => s.options(pool, index).length > 1).length
      return { shown, current: step, options, ahead, group: null as string | null }
    }
    if (options.length > 1) shown.push({ step, value })
    pool = pool.filter((g) => step.value(g) === value)
  }
  return { shown, current: null, options: [], ahead: 0, group: pool[0]?.id ?? null }
}

// ---------- общий вид ----------

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="ob-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="ob-seg" data-on={i < done || undefined} />
      ))}
    </div>
  )
}

function Cards({ options, onPick }: { options: Option[]; onPick: (v: Value) => void }) {
  return (
    <div className="ob-cards">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="ob-card" onClick={() => onPick(o.value)}>
          <span className="ob-card-text">
            <span className="ob-card-label">{o.label}</span>
            {o.sub && <span className="ob-card-sub">{o.sub}</span>}
          </span>
          <ChevronRight className="ob-card-chevron" />
        </button>
      ))}
    </div>
  )
}

function Tiles({ options, wide, onPick }: { options: Option[]; wide?: boolean; onPick: (v: Value) => void }) {
  return (
    <div className={`ob-tiles${wide ? ' ob-tiles-wide' : ''}`}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="ob-tile" onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Shell({ top, children, foot }: { top?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="ob">
      {top && <div className="ob-top">{top}</div>}
      <div className="ob-body">{children}</div>
      {foot && <div className="ob-foot">{foot}</div>}
    </div>
  )
}

// ---------- онбординг ----------

type Screen = 'welcome' | 'role' | 'student' | 'search' | 'teacher'

export function Onboarding({ reason, onDone, onCancel }: Props) {
  const [screen, setScreen] = useState<Screen>(onCancel || reason ? 'role' : 'welcome')
  const [sel, setSel] = useState<Selection>({})
  const [index, setIndex] = useState<GroupsIndex | null>(null)
  const [error, setError] = useState(false)
  const [finishing, setFinishing] = useState<string | null>(null) // имя выбранного — «Открываю расписание…»

  const fetchIndex = useCallback(() => {
    setError(false)
    loadGroups().then(setIndex, () => setError(true))
  }, [])
  // список групп нужен почти сразу — грузим уже на приветствии
  useEffect(fetchIndex, [fetchIndex])

  const walked = useMemo(() => (index ? walk(index, sel) : null), [index, sel])

  const finish = async (choice: Choice, title: string) => {
    haptic('light')
    setFinishing(title)
    try {
      await onDone(choice)
    } catch {
      setFinishing(null)
      setError(true)
    }
  }

  // выбрали всё — группа определилась
  useEffect(() => {
    if (screen === 'student' && walked?.group && !finishing) {
      const g = index!.groups.find((x) => x.id === walked.group)!
      void finish({ role: 'student', group: g.id }, g.name)
    }
    // finish стабилен по смыслу; запускаем только при новой группе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, walked?.group])

  const pick = (key: StepKey, value: Value) => {
    haptic()
    setSel((s) => {
      // всё после этого шага сбрасываем: выбор дальше зависит от него
      const next: Selection = {}
      for (const step of STEPS) {
        if (step.key === key) break
        if (s[step.key] !== undefined) next[step.key] = s[step.key]
      }
      return { ...next, [key]: value }
    })
  }

  const unpick = (key: StepKey) => {
    haptic()
    setSel((s) => {
      const next: Selection = {}
      for (const step of STEPS) {
        if (step.key === key) break
        if (s[step.key] !== undefined) next[step.key] = s[step.key]
      }
      return next
    })
  }

  // «Назад»: снять последний выбор, а с первого шага — к «Кто ты»
  const back = () => {
    haptic()
    if (screen === 'search') return setScreen('student')
    if (screen === 'teacher') return setScreen('role')
    if (screen === 'student') {
      const last = walked?.shown.at(-1)
      if (last) return unpick(last.step.key)
      return setScreen('role')
    }
    if (screen === 'role') return onCancel ? onCancel() : setScreen('welcome')
  }
  useBackButton(screen === 'welcome' || finishing ? null : back)

  if (finishing) {
    return (
      <Shell>
        <div className="ob-hero">
          <div className="ob-emoji">🎓</div>
          <h1 className="ob-title">{finishing}</h1>
          <p className="ob-text">Открываю расписание…</p>
        </div>
      </Shell>
    )
  }

  if (screen === 'welcome') {
    return (
      <Shell
        foot={
          <>
            <button type="button" className="button-primary" onClick={() => (haptic(), setScreen('role'))}>
              Начать
            </button>
            <p className="ob-note">Проект сделан студентом и не является официальным сервисом ГУУ.</p>
          </>
        }
      >
        <div className="ob-hero">
          <div className="ob-emoji">👋</div>
          <p className="ob-overline">Пара слов перед началом</p>
          <h1 className="ob-title">Привет! Я Кирилл</h1>
          <p className="ob-text">Студент 1 курса ГУУ — и автор этого приложения.</p>
          <p className="ob-lead">
            Расписание твоей группы в ГУУ.
            <br />
            Настроим за 30 секунд.
          </p>
        </div>
      </Shell>
    )
  }

  const topBar = (done: number, total: number) => (
    <>
      <div className="ob-bar">
        <button type="button" className="ob-back" onClick={back}>
          {screen === 'role' && onCancel ? 'Отмена' : 'Назад'}
        </button>
        <Progress done={done} total={total} />
      </div>
    </>
  )

  if (screen === 'role') {
    return (
      <Shell top={topBar(1, 3)}>
        <p className="ob-overline">Настроим за 30 секунд</p>
        <h1 className="ob-title">Кто ты?</h1>
        <p className="ob-text">От этого зависит, чьё расписание показывать.</p>
        {reason && <p className="ob-reason">{reason}</p>}
        <div className="ob-cards">
          <button type="button" className="ob-card ob-card-role" onClick={() => (haptic(), setScreen('student'))}>
            <span className="ob-card-emoji">🎓</span>
            <span className="ob-card-text">
              <span className="ob-card-label">Студент</span>
              <span className="ob-card-sub">Расписание своей группы</span>
            </span>
            <ChevronRight className="ob-card-chevron" />
          </button>
          <button type="button" className="ob-card ob-card-role" onClick={() => (haptic(), setScreen('teacher'))}>
            <span className="ob-card-emoji">🧑‍🏫</span>
            <span className="ob-card-text">
              <span className="ob-card-label">Преподаватель</span>
              <span className="ob-card-sub">Расписание по своей фамилии</span>
            </span>
            <ChevronRight className="ob-card-chevron" />
          </button>
        </div>
      </Shell>
    )
  }

  if (screen === 'teacher') {
    return (
      <Shell top={topBar(2, 3)}>
        <h1 className="ob-title">Ваша фамилия</h1>
        <p className="ob-text">Найдём ваше расписание по файлам ГУУ.</p>
        <TeacherPicker onPick={(t) => void finish({ role: 'teacher', teacher: t.id, name: t.name }, t.name)} />
      </Shell>
    )
  }

  if (!index || !walked) {
    return (
      <Shell top={topBar(2, 3)}>
        {error ? (
          <div className="ob-hero">
            <p className="ob-text">Не получилось загрузить список групп. Проверь интернет.</p>
            <button type="button" className="button-secondary" onClick={fetchIndex}>
              Повторить
            </button>
          </div>
        ) : (
          <p className="ob-text">Загружаю группы…</p>
        )}
      </Shell>
    )
  }

  const searchButton = (
    <button type="button" className="button-secondary" onClick={() => (haptic(), setScreen('search'))}>
      🔎 Знаю свою группу
    </button>
  )

  if (screen === 'search') {
    return (
      <Shell top={topBar(2, 3)}>
        <h1 className="ob-title">Найти группу</h1>
        <GroupSearch groups={index.groups} onPick={(g) => void finish({ role: 'student', group: g.id }, g.name)} />
      </Shell>
    )
  }

  // ---------- шаги студента ----------
  const { shown, current, options, ahead } = walked
  if (!current) return null // группа выбрана — сейчас откроется расписание (см. эффект выше)
  const stepNo = shown.length + 1
  const total = shown.length + 1 + ahead
  return (
    <Shell top={topBar(1 + stepNo, 1 + total)} foot={searchButton}>
      {shown.length > 0 && (
        <div className="ob-chips">
          {shown.map(({ step, value }) => (
            <button
              key={step.key}
              type="button"
              className="ob-chip"
              onClick={() => unpick(step.key)}
              aria-label={`Изменить: ${step.chip(value, index)}`}
            >
              <span className="ob-chip-text">{step.chip(value, index)}</span>
              <CloseIcon className="ob-chip-x" />
            </button>
          ))}
        </div>
      )}
      <p className="ob-overline">
        Шаг {stepNo} из {total}
      </p>
      <div key={current.key} className="ob-step">
        <h1 className="ob-title">{current.title}</h1>
        {current.tiles ? (
          <Tiles options={options} wide={current.tiles === 'wide'} onPick={(v) => pick(current.key, v)} />
        ) : (
          <Cards options={options} onPick={(v) => pick(current.key, v)} />
        )}
      </div>
    </Shell>
  )
}
