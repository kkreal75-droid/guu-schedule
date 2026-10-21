import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { saveProfile } from './api'
import { installTelegramMock } from './dev/telegram-mock'
import './index.css'
import { cachedExtras, rememberExtras, type Extras } from './edits'
import { rememberHidden } from './hidden'
import { INTRO_VERSION, introSeen, markIntroDone } from './intro'
import { IntroFlow, type Current } from './onboarding/Intro'
import { Onboarding, type Choice } from './onboarding/Onboarding'
import { defaultPrefs, mergeBootPrefs, readPrefs, savePrefs, type Prefs } from './prefs'
import { GroupMissingError, groupsToLoad, loadSchedule } from './schedule'
import { readCloud, readLocal } from './storage'
import { checkIn, initTelegram, type CheckIn } from './telegram'
import { setLang, t, useLang } from './i18n'
import { bootLang, chooseLang, savedLang } from './language'
import { useTheme } from './theme'

if (import.meta.env.DEV) installTelegramMock()
initTelegram()
// язык — сразу (скелетон и ошибки запуска уже на нём), уточняем после облака и бота
setLang(bootLang(null, null))
// параллельно: визит для статистики и проверка бана, настройки и «знакомство видел» из облака Telegram
const status = checkIn()
const fromCloud = (key: string) => Promise.race([readCloud(key), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
const cloudPrefs = fromCloud('prefs')
const cloudIntro = fromCloud('intro')
const cloudLang = savedLang() ? Promise.resolve(null) : fromCloud('lang')

const root = createRoot(document.getElementById('root')!)

// Пока грузится расписание — каркас главного экрана (скелетон), а не пустой экран с надписью
function Skeleton() {
  return (
    <div className="app skeleton" aria-busy="true" aria-label={t('Загружаю расписание')}>
      <div className="screen-head">
        <span className="sk sk-title" />
        <span className="sk-row">
          <span className="sk sk-round" />
          <span className="sk sk-round" />
        </span>
      </div>
      <div className="sk-body">
        <span className="sk sk-chips" />
        <span className="sk sk-week" />
        <span className="sk sk-days" />
        <span className="sk sk-card" />
        <span className="sk sk-card" />
        <span className="sk sk-card" />
      </div>
    </div>
  )
}
root.render(<Skeleton />)

// Следы старой версии на этом устройстве: заметки, сохранённое расписание — значит, человек не новый
const hasLocalTraces = () =>
  ['notes_cache', 'schedule_cache', 'edits_cache', 'group_cache_b1-mb-mp-1'].some((key) => readLocal(key))

// Выбор из онбординга → настройки (тема и избранное — как были)
function applyChoice(prefs: Prefs, choice: Choice): Prefs {
  return choice.role === 'teacher'
    ? { ...prefs, role: 'teacher', teacher: choice.teacher, teacherName: choice.name, at: Date.now() }
    : { ...prefs, role: 'student', group: choice.group, teacher: null, teacherName: null, at: Date.now() }
}

type Tab = import('./components/TabBar').Tab
// app — расписание; intro — знакомство (этап 7.1: всем один раз, «Показать знакомство ещё раз»);
// onboarding — только выбор группы / роли («Сменить группу / роль», группа пропала из расписания)
type Phase =
  | { kind: 'app'; version: number; tab?: Tab }
  | { kind: 'intro'; registered: boolean }
  | { kind: 'onboarding'; first: boolean; reason?: string; search?: boolean }

// что уже выбрано — для «Это твоя группа?» в знакомстве
function currentChoice(prefs: Prefs): Current {
  if (prefs.role === 'teacher' && prefs.teacher) return { role: 'teacher', teacher: prefs.teacher, name: prefs.teacherName ?? t('Преподаватель') }
  return { role: 'student', group: prefs.group }
}

let versions = 0

function Root({ checked, extras, initial }: { checked: CheckIn | null; extras: Extras; initial: Phase }) {
  useLang() // смена языка — перерисовать всё
  const [phase, setPhase] = useState<Phase>(initial)
  // тема из настроек — и для знакомства (в приложении её дальше ведёт App)
  useTheme(readPrefs().theme)
  const [lastApp, setLastApp] = useState(0) // версия App до онбординга — «Отмена» возвращает его как был

  // настройки поменялись (избранное) — заново грузим расписание и перерисовываем приложение
  const reload = async (tab: Tab) => {
    await loadSchedule(groupsToLoad(readPrefs()))
    setPhase({ kind: 'app', version: ++versions, tab })
  }

  // выбор группы / роли → настройки (устройство + облако Telegram) и боту
  const choose = async (choice: Choice) => {
    const prefs = applyChoice(readPrefs(), choice)
    savePrefs(prefs)
    // боту — для /today, inline и рассылок; не получилось — расписание всё равно откроем
    saveProfile(choice.role === 'teacher' ? { role: 'teacher', teacher: choice.teacher } : choice).catch((err) =>
      console.warn('Не удалось сохранить выбор в боте', err),
    )
  }
  const openApp = async (tab?: Tab) => {
    await loadSchedule(groupsToLoad(readPrefs()))
    setPhase({ kind: 'app', version: ++versions, tab })
  }
  const finish = async (choice: Choice) => {
    await choose(choice)
    await openApp()
  }

  if (phase.kind === 'intro') {
    return (
      <IntroFlow
        current={phase.registered ? currentChoice(readPrefs()) : null}
        onChoice={choose}
        onLang={chooseLang}
        onFinish={async () => {
          markIntroDone()
          await openApp()
        }}
      />
    )
  }

  if (phase.kind === 'onboarding') {
    return (
      <Onboarding
        reason={phase.reason}
        startSearch={phase.search}
        onDone={finish}
        onCancel={phase.first ? undefined : () => setPhase({ kind: 'app', version: lastApp, tab: 'profile' })}
      />
    )
  }
  return (
    <AppLazy
      key={phase.version}
      status={checked}
      extras={extras}
      startTab={phase.tab}
      onReload={reload}
      onChangeProfile={(search) => {
        setLastApp(phase.version)
        setPhase({ kind: 'onboarding', first: false, search })
      }}
      onSaveChoice={async (choice) => {
        await choose(choice)
        await openApp('profile')
      }}
      onShowIntro={() => setPhase({ kind: 'intro', registered: true })}
    />
  )
}

// App подгружаем после данных: его модули читают schedule уже при запуске
let AppLazy: typeof import('./App').default

async function boot() {
  const [checked, cloud, cloudIntroSeen, cloudLangValue] = await Promise.all([status, cloudPrefs, cloudIntro, cloudLang])
  setLang(bootLang(cloudLangValue, checked?.me?.lang))
  if (checked?.banned) {
    root.render(
      <div className="boot">
        <p className="boot-title">{t('Доступ ограничен')}</p>
        <p>{t('Владелец бота ограничил вам доступ к расписанию.')}</p>
      </div>,
    )
    return
  }
  // техработы включаются в админ-панели; самому админу бот этот текст не присылает
  if (checked?.maintenance) {
    root.render(
      <div className="boot">
        <p className="boot-title">{t('🛠 Технические работы')}</p>
        <p className="boot-text">{checked.maintenance}</p>
      </div>,
    )
    return
  }
  // правки расписания, подгруппы, скрытое для всей группы: свежие от бота, а если он не ответил — последние
  // сохранённые; свои скрытые пары — тоже (App берёт их из копии на устройстве)
  const fresh: Extras | null = checked
    ? { edits: checked.edits, subgroups: checked.subgroups, tags: checked.tags, hidden: checked.hidden }
    : null
  if (fresh) rememberExtras(fresh)
  if (checked?.myHidden) rememberHidden(checked.myHidden)
  const extras = fresh ?? cachedExtras()

  // Чьё расписание показывать. Порядок: настройки на устройстве / в облаке Telegram → выбор, который
  // помнит бот (другое устройство) → онбординг для новых → МБ(МП) 1-1 по умолчанию (как раньше)
  const merged = mergeBootPrefs(readLocal('prefs'), cloud)
  let initial: Phase = { kind: 'app', version: 0 }
  const me = checked?.me
  if (!merged || merged.groupless) {
    if (me?.role === 'teacher' && me.teacher) {
      savePrefs({ ...(merged ?? defaultPrefs()), role: 'teacher', teacher: me.teacher, at: Date.now() })
    } else if (me?.group) {
      savePrefs({ ...(merged ?? defaultPrefs()), role: 'student', group: me.group, at: Date.now() })
    } else if (me?.onboarding || (!checked && !hasLocalTraces())) {
      initial = { kind: 'intro', registered: false }
    }
  }
  // знакомство новой версии — всем один раз, включая старых пользователей и МБ (им — «Это твоя группа?»)
  const needIntro = introSeen(cloudIntroSeen, me?.intro) < INTRO_VERSION
  if (initial.kind === 'app' && needIntro) initial = { kind: 'intro', registered: true }

  // своё расписание грузим сразу (и для знакомства — к его концу оно уже будет готово)
  if (initial.kind === 'app' || (initial.kind === 'intro' && initial.registered)) {
    try {
      await loadSchedule(groupsToLoad(readPrefs()))
    } catch (err) {
      // группы больше нет в расписании ГУУ — выбрать заново
      if (!(err instanceof GroupMissingError)) throw err
      initial = needIntro
        ? { kind: 'intro', registered: false }
        : { kind: 'onboarding', first: true, reason: t('Твоей группы больше нет в расписании ГУУ — выбери заново.') }
    }
  }
  AppLazy = (await import('./App')).default
  root.render(
    <StrictMode>
      <Root checked={checked} extras={extras} initial={initial} />
    </StrictMode>,
  )
}

boot().catch((err) => {
  console.error(err)
  root.render(
    <div className="boot">
      <p>{t('Не удалось загрузить расписание. Проверьте интернет.')}</p>
      <button type="button" className="boot-retry" onClick={() => location.reload()}>
        {t('Повторить')}
      </button>
    </div>,
  )
})
