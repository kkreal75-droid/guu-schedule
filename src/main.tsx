import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { saveFavorites, saveProfile } from './api'
import { installTelegramMock } from './dev/telegram-mock'
import './index.css'
import { cachedExtras, rememberExtras, type Extras } from './edits'
import { rememberHidden } from './hidden'
import { INTRO_VERSION, introSeen, markIntroDone } from './intro'
import { IntroFlow, type Current } from './onboarding/Intro'
import { Onboarding, type Choice } from './onboarding/Onboarding'
import { cleanFavorites, defaultPrefs, mergeBootPrefs, migrateFavorites, parsePrefs, readPrefs, savePrefs, type Prefs } from './prefs'
import { GroupMissingError, groupsToLoad, homeOf, loadSchedule } from './schedule'
import { readCloud, readLocal } from './storage'
import { checkIn, initTelegram, type CheckIn } from './telegram'
import { getLang, setLang, t, useLang } from './i18n'
import { loadEnglishNames } from './guu'
import { bootLang, chooseLang, savedLang } from './language'
import { isLang } from '../shared/i18n-core'
import { useTheme } from './theme'

if (import.meta.env.DEV) installTelegramMock()
// ?scan — проверка английской версии на отрисованных экранах (src/dev/i18n-scan.ts)
if (import.meta.env.DEV && new URLSearchParams(location.search).has('scan')) void import('./dev/i18n-scan').then((m) => m.runI18nScan())
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

// Пока грузится расписание — каркас главного экрана (скелетон), а не пустой экран с надписью: дата,
// вкладки, неделя, дни, карточки пар
function Skeleton() {
  return (
    <div className="app skeleton" aria-busy="true" aria-label={t('Загружаю расписание')}>
      <div className="sk-body">
        <span className="sk sk-title" />
        <span className="sk sk-tabs" />
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
// Выбор группы / роли. Настроек ещё не было (новый) — избранное с нуля: у МБ вторая группа появится чипом уже
// для выбранной группы (migrateFavorites); своё расписание в избранном не дублируем
function applyChoice(prefs: Prefs, choice: Choice): Prefs {
  const base = readLocal('prefs') ? prefs : { ...prefs, favorites: [], favVersion: 1 }
  const next: Prefs =
    choice.role === 'teacher'
      ? { ...base, role: 'teacher', teacher: choice.teacher, teacherName: choice.name, at: Date.now() }
      : { ...base, role: 'student', group: choice.group, teacher: null, teacherName: null, at: Date.now() }
  const home = homeOf(next)
  return migrateFavorites({ ...next, favorites: next.favorites.filter((id) => id !== home) })
}

type Tab = import('./components/TabBar').Tab
// app — расписание; intro — знакомство (этап 7.1: всем один раз, «Показать знакомство ещё раз»);
// onboarding — только выбор группы / роли («Сменить группу / роль», группа пропала из расписания)
type Phase =
  | { kind: 'app'; version: number; tab?: Tab }
  | { kind: 'intro'; registered: boolean; askLang: boolean } // askLang — первым экраном выбор языка
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
        askLang={phase.askLang}
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
      onShowIntro={() => setPhase({ kind: 'intro', registered: true, askLang: true })}
    />
  )
}

// App подгружаем после данных: его модули читают schedule уже при запуске
let AppLazy: typeof import('./App').default

async function boot() {
  const [checked, cloud, cloudIntroSeen, cloudLangValue] = await Promise.all([status, cloudPrefs, cloudIntro, cloudLang])
  // выбирал ли человек язык сам (на устройстве, в облаке, у бота) — нет: в знакомстве спросим
  const langChosen = Boolean(savedLang() || isLang(cloudLangValue) || isLang(checked?.me?.lang))
  setLang(bootLang(cloudLangValue, checked?.me?.lang))
  // английский: названия ГУУ — до первого показа (не дольше 1,5 с; не успели — перерисуем, когда загрузятся)
  if (getLang() === 'en') await Promise.race([loadEnglishNames(), new Promise((r) => setTimeout(r, 1500))])
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
        {getLang() === 'en' && checked.maintenanceEn ? (
          <p className="boot-text">{checked.maintenanceEn}</p>
        ) : (
          <p className="boot-text" lang="ru">
            {checked.maintenance}
          </p>
        )}
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
      initial = { kind: 'intro', registered: false, askLang: true }
    }
  }
  // избранное (этап 12): копия у бота новее (менял на другом устройстве) — берём её; наша новее — отправим боту.
  // Только у тех, у кого настройки уже есть (новым — после онбординга)
  if (readLocal('prefs')) {
    const prefs = readPrefs()
    const bot = me?.favorites
    const botAt = me?.favorites_at ?? 0
    if (bot && botAt > prefs.favAt) savePrefs({ ...prefs, favorites: cleanFavorites(bot), favAt: botAt })
    else if (checked && prefs.favAt > botAt) saveFavorites(prefs.favorites, prefs.favAt).catch(() => {})
    else if (prefs.favVersion !== parsePrefs(readLocal('prefs'))?.favVersion) savePrefs(prefs) // перенос «1-1 / 1-2»
  }
  // знакомство новой версии — всем один раз, включая старых пользователей и МБ (им — «Это твоя группа?»)
  const needIntro = introSeen(cloudIntroSeen, me?.intro) < INTRO_VERSION
  if (initial.kind === 'app' && needIntro) initial = { kind: 'intro', registered: true, askLang: !langChosen }

  // своё расписание грузим сразу (и для знакомства — к его концу оно уже будет готово)
  if (initial.kind === 'app' || (initial.kind === 'intro' && initial.registered)) {
    try {
      await loadSchedule(groupsToLoad(readPrefs()))
    } catch (err) {
      // группы больше нет в расписании ГУУ — выбрать заново
      if (!(err instanceof GroupMissingError)) throw err
      initial = needIntro
        ? { kind: 'intro', registered: false, askLang: true }
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
