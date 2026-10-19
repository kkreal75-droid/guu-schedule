import { useState } from 'react'
import { CalendarIcon, UserIcon } from './icons'
import { useNotes } from './notes'
import { usePrefs } from './prefs'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScheduleScreen, initialCursor, type Cursor } from './screens/ScheduleScreen'
import { haptic } from './telegram'
import { useTheme } from './theme'

type Tab = 'schedule' | 'profile'

export default function App() {
  const [prefs, updatePrefs] = usePrefs()
  const { notes, setNote } = useNotes()
  useTheme(prefs.theme)

  const [tab, setTab] = useState<Tab>('schedule')
  // группа, выбранная переключателем на экране расписания; null — показываем группу по умолчанию
  const [viewGroup, setViewGroup] = useState<string | null>(null)
  const [cursor, setCursor] = useState<Cursor>(initialCursor)

  const switchTab = (next: Tab) => {
    if (next === tab) return
    haptic()
    setTab(next)
    window.scrollTo(0, 0)
  }

  return (
    <div className="app">
      {tab === 'schedule' ? (
        <ScheduleScreen
          group={viewGroup ?? prefs.group}
          onGroupChange={setViewGroup}
          cursor={cursor}
          onCursorChange={setCursor}
          notes={notes}
          onSaveNote={setNote}
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

      <nav className="tabbar">
        <button type="button" className="tab" aria-current={tab === 'schedule'} onClick={() => switchTab('schedule')}>
          <CalendarIcon />
          <span>Расписание</span>
        </button>
        <button type="button" className="tab" aria-current={tab === 'profile'} onClick={() => switchTab('profile')}>
          <UserIcon />
          <span>Профиль</span>
        </button>
      </nav>
    </div>
  )
}
