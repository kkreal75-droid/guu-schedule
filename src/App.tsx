import { useCallback, useState } from 'react'
import { teacherKey } from '../shared/schedule-core'
import { hasNew, markSeen } from './board/seen'
import { NoticeBar } from './components/NoticeBar'
import type { Extras } from './edits'
import { formatStamp } from './format'
import { CalendarIcon, MoreIcon, UserIcon } from './icons'
import { useNotes } from './notes'
import { usePrefs } from './prefs'
import { MoreScreen } from './screens/MoreScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScheduleScreen, initialCursor, type Cursor } from './screens/ScheduleScreen'
import { fromCache, schedule } from './schedule'
import { haptic, type CheckIn } from './telegram'
import { useTheme } from './theme'

export type Tab = 'schedule' | 'more' | 'profile'

// status — ответ бота при открытии (админ ли); null — вне Telegram или бот недоступен.
// edits — ручные правки расписания из админ-панели.
// onChangeProfile — «Сменить группу / роль»: снова онбординг; onReload — перегрузить расписание
// после смены избранного (см. main.tsx); startTab — какую вкладку открыть после перезагрузки
type Props = {
  status: CheckIn | null
  extras: Extras
  startTab?: Tab
  onReload: (tab: Tab) => Promise<void>
  onChangeProfile: () => void
}

export default function App({ status, extras: initialExtras, startTab, onReload, onChangeProfile }: Props) {
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
  const [tab, setTab] = useState<Tab>(startTab ?? 'schedule')
  // группа, выбранная переключателем на экране расписания; null — своя
  const [viewGroup, setViewGroup] = useState<string | null>(null)
  const shownGroup = viewGroup && schedule.groups.includes(viewGroup) ? viewGroup : home
  const [cursor, setCursor] = useState<Cursor>(initialCursor)
  // точка «есть новое» в «Подслушано»: на «Ещё» и на пункте, без счётчиков
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
    setTab(next)
    window.scrollTo(0, 0)
  }

  const updatedAt = schedule.updated_at ? formatStamp(schedule.updated_at) : null

  return (
    <div className="app">
      {tab === 'schedule' && status?.notice && <NoticeBar notice={status.notice} />}
      {tab === 'schedule' ? (
        <ScheduleScreen
          extras={extras}
          mine={shownGroup === prefs.group ? prefs.subgroups : null}
          group={shownGroup}
          groups={schedule.groups}
          onGroupChange={setViewGroup}
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
          onChangeProfile={onChangeProfile}
        />
      )}

      {updatedAt && (
        <p className="updated">
          Обновлено: {updatedAt}
          {fromCache && ' · нет сети, сохранённая копия'}
        </p>
      )}

      <nav className="tabbar">
        <button type="button" className="tab" aria-current={tab === 'schedule'} onClick={() => switchTab('schedule')}>
          <CalendarIcon />
          <span>Расписание</span>
        </button>
        <button type="button" className="tab" aria-current={tab === 'more'} onClick={() => switchTab('more')}>
          <MoreIcon />
          <span>Ещё</span>
          {boardNew && <span className="new-dot" aria-label="есть новое" />}
        </button>
        <button type="button" className="tab" aria-current={tab === 'profile'} onClick={() => switchTab('profile')}>
          <UserIcon />
          <span>Профиль</span>
        </button>
      </nav>
    </div>
  )
}
