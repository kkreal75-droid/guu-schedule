import { useCallback, useState } from 'react'
import { hasNew, markSeen } from './board/seen'
import { NoticeBar } from './components/NoticeBar'
import type { ScheduleEdit } from './edits'
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

type Tab = 'schedule' | 'more' | 'profile'

// status — ответ бота при открытии (админ ли); null — вне Telegram или бот недоступен.
// edits — ручные правки расписания из админ-панели.
export default function App({ status, edits }: { status: CheckIn | null; edits: ScheduleEdit[] }) {
  const [prefs, updatePrefs] = usePrefs()
  const { notes, setNote } = useNotes()
  useTheme(prefs.theme)

  const [tab, setTab] = useState<Tab>('schedule')
  // группа, выбранная переключателем на экране расписания; null — показываем группу по умолчанию
  const [viewGroup, setViewGroup] = useState<string | null>(null)
  const [cursor, setCursor] = useState<Cursor>(initialCursor)
  // точка «есть новое» на доске: «Ещё» и «Доска», без счётчиков
  const [boardNew, setBoardNew] = useState(() => hasNew(status?.board))
  const onBoardOpen = useCallback(() => {
    markSeen(status?.board ?? {})
    setBoardNew(false)
  }, [status])

  const switchTab = (next: Tab) => {
    if (next === tab) return
    haptic()
    setTab(next)
    window.scrollTo(0, 0)
  }

  const updatedAt = schedule.updated_at ? formatStamp(schedule.updated_at) : null

  return (
    <div className="app">
      {tab === 'schedule' && status?.notice && <NoticeBar notice={status.notice} />}
      {tab === 'schedule' ? (
        <ScheduleScreen
          edits={edits}
          group={viewGroup ?? prefs.group}
          onGroupChange={setViewGroup}
          cursor={cursor}
          onCursorChange={setCursor}
          notes={notes}
          onSaveNote={setNote}
        />
      ) : tab === 'more' ? (
        <MoreScreen
          admin={Boolean(status?.admin)}
          group={viewGroup ?? prefs.group}
          boardNew={boardNew}
          onBoardOpen={onBoardOpen}
        />
      ) : (
        <ProfileScreen
          noteCount={Object.keys(notes).length}
          prefs={prefs}
          onChange={(patch) => {
            if (patch.group) setViewGroup(null)
            updatePrefs(patch)
          }}
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
