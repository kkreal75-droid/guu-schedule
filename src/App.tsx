import { useCallback, useEffect, useState } from 'react'
import { AddGroupSheet } from './components/AddGroupSheet'
import { loadTeachers } from './data'
import type { Choice } from './onboarding/Onboarding'
import { teacherKey } from '../shared/schedule-core'
import { hasNew, markSeen } from './board/seen'
import { NoticeBar } from './components/NoticeBar'
import type { Extras } from './edits'
import { formatStamp } from './format'
import { useNotes } from './notes'
import { MAX_FAVORITES, usePrefs } from './prefs'
import { TabBar, type Tab } from './components/TabBar'
import { MoreScreen, type MoreRequest } from './screens/MoreScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScheduleScreen, initialCursor, type Cursor } from './screens/ScheduleScreen'
import { fromCache, schedule } from './schedule'
import { haptic, showAlert, type CheckIn } from './telegram'
import { useTheme } from './theme'

export type { Tab }

// status — ответ бота при открытии (админ ли); null — вне Telegram или бот недоступен.
// edits — ручные правки расписания из админ-панели.
// onChangeProfile — выбор группы в онбординге (search — сразу поиск); onSaveChoice — «Профиль → Параметры
// аккаунта → Сохранить»; onReload — перегрузить расписание
// после смены избранного (см. main.tsx); startTab — какую вкладку открыть после перезагрузки
type Props = {
  status: CheckIn | null
  extras: Extras
  startTab?: Tab
  onReload: (tab: Tab) => Promise<void>
  onChangeProfile: (search?: boolean) => void
  onSaveChoice: (choice: Choice) => Promise<void>
  onShowIntro: () => void // «Показать знакомство ещё раз»
}

// Мини-приложение открыли кнопкой из рассылки бота: «?open=session» — сразу экран сессии
// (параметр убираем из адреса после первого показа, чтобы не открывать его при каждой перерисовке)
function openedFrom(): MoreRequest | null {
  return new URLSearchParams(window.location.search).get('open') === 'session' ? { item: 'session' } : null
}
function forgetOpened() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('open')) return
  url.searchParams.delete('open')
  window.history.replaceState(window.history.state, '', url)
}

export default function App({ status, extras: initialExtras, startTab, onReload, onChangeProfile, onSaveChoice, onShowIntro }: Props) {
  const [prefs, updatePrefs] = usePrefs()
  // правки и подгруппы; староста меняет их — обновляем сразу, без перезапуска
  const [extras, setExtras] = useState(initialExtras)
  const onGroupExtras = useCallback((group: string, next: Extras) => {
    setExtras((cur) => ({
      edits: [...cur.edits.filter((e) => e.group !== group), ...next.edits],
      subgroups: [...cur.subgroups.filter((s) => s.group !== group), ...next.subgroups],
      tags: [...cur.tags.filter((t) => t.group !== group), ...next.tags],
    }))
  }, [])
  const { notes, setNote } = useNotes()
  useTheme(prefs.theme)

  // своё расписание: преподавателю — его пары, студенту — его группа
  const home = prefs.role === 'teacher' && prefs.teacher ? teacherKey(prefs.teacher) : prefs.group
  const [tab, setTab] = useState<Tab>(() => startTab ?? (openedFrom() ? 'more' : 'schedule'))
  // группа, выбранная переключателем на экране расписания; null — своя
  const [viewGroup, setViewGroup] = useState<string | null>(null)
  const shownGroup = viewGroup && schedule.groups.includes(viewGroup) ? viewGroup : home
  const [cursor, setCursor] = useState<Cursor>(initialCursor)
  // точка «есть новое» в Подслушано: на «Другом» и на пункте, без счётчиков
  const [boardNew, setBoardNew] = useState(() => hasNew(status?.board))
  // «Подслушано»: курс и институт у псевдонима (хранит бот); null — бот недоступен
  const [boardOrigin, setBoardOrigin] = useState<boolean | null>(status?.me ? Boolean(status.me.origin) : null)
  const onBoardOpen = useCallback(() => {
    markSeen(status?.board ?? {})
    setBoardNew(false)
  }, [status])

  // избранное поменялось — расписание перегрузим, когда человек вернётся на вкладку «Расписание»
  const [favoritesChanged, setFavoritesChanged] = useState(false)
  const switchTab = (next: Tab) => {
    if (next === tab) return
    haptic()
    if (next === 'schedule' && favoritesChanged) return void onReload('schedule')
    setMoreRequest(null)
    setTab(next)
    window.scrollTo(0, 0)
  }

  const updatedAt = schedule.updated_at ? formatStamp(schedule.updated_at) : null

  // нажатие на преподавателя в паре — его карточка в «Другое → Рейтинг преподавателей»; «Назад» — сюда
  const [moreRequest, setMoreRequest] = useState<MoreRequest | null>(() => (startTab ? null : openedFrom()))
  useEffect(forgetOpened, [])
  const openTeacher = useCallback(async (name: string) => {
    haptic()
    const list = await loadTeachers().then((d) => d.teachers, () => null)
    const teacher = list?.find((t) => t.name === name)
    if (!teacher) return showAlert(list ? `${name} нет в списке преподавателей ГУУ.` : 'Нет связи. Попробуй ещё раз.')
    setMoreRequest({ item: 'teachers', teacher })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  // нажатие на аудиторию в паре — карточка корпуса в «Другое → Корпуса ГУУ»; «Назад» — сюда
  const openRoom = useCallback((room: string) => {
    haptic()
    setMoreRequest({ item: 'places', room })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  const backToSchedule = useCallback(() => {
    setMoreRequest(null)
    setTab('schedule')
    window.scrollTo(0, 0)
  }, [])

  // «+» у чипов групп: добавить в избранное и перегрузить расписание с ней
  const [addingGroup, setAddingGroup] = useState(false)
  const closeAdding = useCallback(() => setAddingGroup(false), [])
  const addFavorite = (id: string) => {
    setAddingGroup(false)
    if (prefs.favorites.includes(id) || prefs.favorites.length >= MAX_FAVORITES) return
    updatePrefs({ favorites: [...prefs.favorites, id] })
    void onReload('schedule')
  }

  return (
    <div className="app">
      {tab === 'schedule' && status?.notice && <NoticeBar notice={status.notice} />}
      {tab === 'schedule' ? (
        <ScheduleScreen
          extras={extras}
          mine={shownGroup === prefs.group ? prefs.subgroups : null}
          group={shownGroup}
          groups={schedule.groups}
          home={home}
          onGroupChange={setViewGroup}
          onAddGroup={() => (haptic(), setAddingGroup(true))}
          onTeacher={shownGroup.startsWith('t-') ? undefined : openTeacher}
          onRoom={openRoom}
          cursor={cursor}
          onCursorChange={setCursor}
          notes={notes}
          onSaveNote={setNote}
        />
      ) : tab === 'more' ? (
        <MoreScreen
          admin={Boolean(status?.admin)}
          group={shownGroup}
          teacherMode={prefs.role === 'teacher'}
          boardNew={boardNew}
          onBoardOpen={onBoardOpen}
          prefs={prefs}
          extras={extras}
          starosta={status?.me?.starosta ?? null}
          onGroupExtras={onGroupExtras}
          channel={status?.channel}
          request={moreRequest}
          onRequestBack={backToSchedule}
          onPrefsChange={(patch) => {
            updatePrefs(patch)
            if (patch.favorites) setFavoritesChanged(true)
          }}
        />
      ) : (
        <ProfileScreen
          noteCount={Object.keys(notes).length}
          prefs={prefs}
          extras={extras}
          boardOrigin={boardOrigin}
          onBoardOrigin={setBoardOrigin}
          onChange={(patch) => {
            updatePrefs(patch)
            if (patch.favorites) setFavoritesChanged(true)
          }}
          onSearchGroup={() => onChangeProfile(true)}
          onSaveChoice={onSaveChoice}
          onShowIntro={onShowIntro}
        />
      )}

      {addingGroup && (
        <AddGroupSheet
          exclude={schedule.groups}
          full={prefs.favorites.length >= MAX_FAVORITES}
          onPick={(g) => addFavorite(g.id)}
          onClose={closeAdding}
        />
      )}

      {updatedAt && (
        <p className="updated">
          Обновлено: {updatedAt}
          {fromCache && ' · нет сети, сохранённая копия'}
        </p>
      )}

      <TabBar tab={tab} onTab={switchTab} dot={boardNew} />
    </div>
  )
}
