// Регистрация: «Кто ты?» → студент: 7 шагов (форма → уровень → курс → институт → направление → программа →
// группа) → «Это твоя группа» → «Сохранить»; преподаватель: поиск по фамилии → подтверждение.
// Шаги с одним вариантом выбираются сами (номер шага при этом не сбивается: «Шаг 6 из 7»); тап по карточке
// сразу ведёт дальше; выбранное — хлебными крошками сверху, нажатие возвращает к шагу; на любом шаге —
// «Знаю свою группу» (поиск по всем группам). Части знакомства (этап 7.1) и «Профиль → Сменить группу / роль».
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FORM_TITLES, LEVEL_TITLES, type GroupInfo, type GroupsIndex } from '../../shared/groups'
import { loadGroups } from '../data'
import { ChevronRight, CloseIcon, SearchIcon } from '../icons'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupSearch } from './GroupSearch'
import { EmojiTile } from './Stories'
import { TeacherPicker } from './TeacherPicker'

export type Choice = { role: 'student'; group: string } | { role: 'teacher'; teacher: string; name: string }

type Props = {
  reason?: string // почему снова: «группы больше нет в расписании»
  startSearch?: boolean // «Профиль → Знаю свою группу» — сразу поиск
  onDone: (choice: Choice) => Promise<void>
  onCancel?: () => void // «Назад» с первого экрана (к знакомству или в профиль)
  cancelLabel?: string
}

// ---------- шаги студента ----------

export type StepKey = 'form' | 'level' | 'course' | 'institute' | 'direction' | 'program' | 'group'
export type Value = string | number
export type Option = { value: Value; label: string; sub?: string }

export type Step = {
  key: StepKey
  title: string
  tiles?: 'small' | 'wide' // плитки вместо карточек: курс — маленькие, группы — по две в ряд
  value: (g: GroupInfo) => Value
  options: (pool: GroupInfo[], index: GroupsIndex) => Option[]
  chip: (v: Value, index: GroupsIndex) => string
}

const LEVEL_ORDER = ['bachelor', 'master', 'postgrad']

const uniq = <T,>(items: T[]) => [...new Set(items)]
const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'ru')

export const STEPS: Step[] = [
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
    title: 'На каком ты курсе?',
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
        .map((v) => ({ value: v, label: index.institutes[v] ?? v, sub: index.institutes[v] ? v : undefined }))
        .sort(byLabel),
    chip: (v) => String(v),
  },
  {
    key: 'direction',
    title: 'Направление',
    value: (g) => g.direction,
    options: (pool) =>
      uniq(pool.map((g) => g.direction))
        .map((v) => ({ value: v, label: v }))
        .sort(byLabel),
    chip: (v) => String(v),
  },
  {
    key: 'program',
    title: 'Образовательная программа',
    value: (g) => g.program,
    options: (pool) =>
      uniq(pool.map((g) => g.program))
        .map((v) => ({ value: v, label: v }))
        .sort(byLabel),
    chip: (v) => String(v),
  },
  {
    key: 'group',
    title: 'Твоя группа',
    tiles: 'wide',
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

export function Shell({ top, children, foot }: { top?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="ob">
      {top && <div className="ob-top">{top}</div>}
      <div className="ob-body">{children}</div>
      {foot && <div className="ob-foot">{foot}</div>}
    </div>
  )
}

// Карточка «Это твоя группа» — в конце регистрации и в знакомстве у тех, кто уже выбирал
export function GroupCard({ emoji, name, text }: { emoji: string; name: string; text: string }) {
  return (
    <div className="ob-confirm ob-step">
      <EmojiTile emoji={emoji} />
      <h2 className="ob-confirm-name">{name}</h2>
      <p className="ob-text">{text}</p>
    </div>
  )
}

// ---------- регистрация ----------

type Screen = 'role' | 'student' | 'search' | 'teacher'
type Picked = { choice: Choice; name: string; from: Screen }

export function Onboarding({ reason, startSearch, onDone, onCancel, cancelLabel = 'Назад' }: Props) {
  const [screen, setScreen] = useState<Screen>(startSearch ? 'search' : 'role')
  const [sel, setSel] = useState<Selection>({})
  const [index, setIndex] = useState<GroupsIndex | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null) // выбрано — карточка «Это твоя группа»
  const [saving, setSaving] = useState(false)

  const fetchIndex = useCallback(() => {
    setError(false)
    loadGroups().then(setIndex, () => setError(true))
  }, [])
  useEffect(fetchIndex, [fetchIndex])

  const walked = useMemo(() => (index ? walk(index, sel) : null), [index, sel])

  // все шаги пройдены — группа определилась
  useEffect(() => {
    if (screen === 'student' && walked?.group && !picked) {
      setPicked({ choice: { role: 'student', group: walked.group.id }, name: walked.group.name, from: 'student' })
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

  // «Назад»: с карточки — к выбору; на шагах — снять последний ручной выбор; с первого экрана — onCancel
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

  const backButton = canBack && (
    <button type="button" className="button-secondary" onClick={back} disabled={saving}>
      {screen === 'role' && !picked ? cancelLabel : 'Назад'}
    </button>
  )

  // ---------- карточка «Это твоя группа» ----------
  if (picked) {
    const student = picked.choice.role === 'student'
    return (
      <Shell
        top={<Progress done={8} total={8} />}
        foot={
          <>
            <button type="button" className="button-primary" onClick={save} disabled={saving}>
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
            {backButton}
          </>
        }
      >
        {student && walked && index && picked.from === 'student' && <Crumbs crumbs={walked.crumbs} index={index} onUnpick={unpick} />}
        {error && <p className="ob-reason">Не получилось сохранить. Проверь интернет и попробуй ещё раз.</p>}
        <GroupCard
          emoji={student ? '🎓' : '🧑‍🏫'}
          name={picked.name}
          text={student ? 'Это твоя группа. Расписание уже готово — осталось сохранить.' : 'Ваше расписание по файлам ГУУ уже готово — осталось сохранить.'}
        />
      </Shell>
    )
  }

  if (screen === 'role') {
    return (
      <Shell top={<Progress done={1} total={8} />} foot={<>{backButton}<p className="ob-note">Это займёт меньше минуты</p></>}>
        <div className="ob-step ob-role">
          <p className="ob-overline">Настройка</p>
          <h1 className="ob-title">Кто ты?</h1>
          <p className="ob-text">Выбери — и сразу покажу нужное расписание.</p>
          {reason && <p className="ob-reason">{reason}</p>}
          <div className="ob-cards">
            <button type="button" className="ob-card ob-card-role" onClick={() => (haptic(), setScreen('student'))}>
              <span className="ob-card-emoji">🎓</span>
              <span className="ob-card-text">
                <span className="ob-card-label">Я студент</span>
                <span className="ob-card-sub">Расписание своей группы</span>
              </span>
              <ChevronRight className="ob-card-chevron" />
            </button>
            <button type="button" className="ob-card ob-card-role" onClick={() => (haptic(), setScreen('teacher'))}>
              <span className="ob-card-emoji">🧑‍🏫</span>
              <span className="ob-card-text">
                <span className="ob-card-label">Я преподаватель</span>
                <span className="ob-card-sub">Расписание по своему ФИО</span>
              </span>
              <ChevronRight className="ob-card-chevron" />
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (screen === 'teacher') {
    return (
      <Shell top={<Progress done={4} total={8} />} foot={backButton}>
        <div className="ob-step">
          <p className="ob-overline">Преподаватель</p>
          <h1 className="ob-title">Ваша фамилия</h1>
          <p className="ob-text">Найдём ваше расписание по файлам ГУУ.</p>
          <TeacherPicker onPick={(t) => (haptic(), setPicked({ choice: { role: 'teacher', teacher: t.id, name: t.name }, name: t.name, from: 'teacher' }))} />
        </div>
      </Shell>
    )
  }

  if (!index || !walked) {
    return (
      <Shell top={<Progress done={1} total={8} />} foot={backButton}>
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

  if (screen === 'search') {
    return (
      <Shell top={<Progress done={4} total={8} />} foot={backButton}>
        <div className="ob-step">
          <p className="ob-overline">Поиск</p>
          <h1 className="ob-title">Знаю свою группу</h1>
          <GroupSearch
            groups={index.groups}
            onPick={(g) => (haptic(), setPicked({ choice: { role: 'student', group: g.id }, name: g.name, from: 'search' }))}
          />
        </div>
      </Shell>
    )
  }

  // ---------- шаги студента ----------
  const { crumbs, current, options } = walked
  if (!current) return null // группа определилась — сейчас покажется карточка (см. эффект выше)
  const stepNo = STEPS.indexOf(current) + 1
  return (
    <Shell
      top={<Progress done={1 + stepNo} total={8} />}
      foot={
        <>
          <button type="button" className="ob-link" onClick={() => (haptic(), setScreen('search'))}>
            <SearchIcon /> Знаю свою группу
          </button>
          {backButton}
        </>
      }
    >
      <Crumbs crumbs={crumbs} index={index} onUnpick={unpick} />
      <p className="ob-overline">
        Шаг {stepNo} из {STEPS.length}
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

// Хлебные крошки: выбранное на прошлых шагах; нажатие — вернуться к шагу (выбранное сами — без крестика)
function Crumbs({ crumbs, index, onUnpick }: { crumbs: Crumb[]; index: GroupsIndex; onUnpick: (key: StepKey) => void }) {
  if (!crumbs.length) return null
  return (
    <div className="ob-chips">
      {crumbs.map(({ step, value, auto }) =>
        auto ? (
          <span key={step.key} className="ob-chip ob-chip-auto">
            <span className="ob-chip-text">{step.chip(value, index)}</span>
          </span>
        ) : (
          <button
            key={step.key}
            type="button"
            className="ob-chip"
            onClick={() => onUnpick(step.key)}
            aria-label={`Изменить: ${step.chip(value, index)}`}
          >
            <span className="ob-chip-text">{step.chip(value, index)}</span>
            <CloseIcon className="ob-chip-x" />
          </button>
        ),
      )}
    </div>
  )
}
