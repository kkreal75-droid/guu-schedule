import { useCallback, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { Section } from '../components/Section'
import { AdminPage } from '../admin/AdminPage'
import { BoardPage } from '../board/BoardPage'
import type { Extras } from '../edits'
import {
  ChevronLeft, ChevronRight, DoorIcon, EditIcon, ExamIcon, GroupChatIcon, PhoneCalendarIcon, SearchIcon,
  ShieldIcon, StarIcon, TeacherIcon, ChatIcon,
} from '../icons'
import { CalendarPage } from '../more/CalendarPage'
import { FreeRoomsPage } from '../more/FreeRoomsPage'
import { GroupBotPage } from '../more/GroupBotPage'
import { GroupSchedulePage } from '../more/GroupSchedulePage'
import { SessionPage } from '../more/SessionPage'
import { StarostaPage } from '../more/StarostaPage'
import { TeacherSchedulePage } from '../more/TeacherSchedulePage'
import { TeachersPage } from '../more/TeachersPage'
import type { Prefs } from '../prefs'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'

// «Ещё» — всё дополнительное, чтобы не мешать расписанию. Каждый пункт — своя страница.
type Item = {
  id: string
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  render: () => ReactNode // элемент, а не компонент: иначе при перерисовке страница сбрасывала бы состояние
  dot?: boolean
  bare?: boolean // страница рисует свою шапку (у админ-панели вложенные разделы)
}

// group — группа на экране расписания; teacherMode — роль «Преподаватель» (сессия и календарь — для групп);
// boardNew — точка «есть новое» в чате; onBoardOpen — человек зашёл туда, точку убрать;
// prefs / onPrefsChange — избранные группы
type Props = {
  admin: boolean
  group: string
  teacherMode: boolean
  boardNew: boolean
  onBoardOpen: () => void
  prefs: Prefs
  onPrefsChange: (patch: Partial<Prefs>) => void
  extras: Extras
  starosta: string | null // староста этой группы — «Правки группы»
  onGroupExtras: (group: string, extras: Extras) => void
}

export function MoreScreen({ admin, group, teacherMode, boardNew, onBoardOpen, prefs, onPrefsChange, starosta, onGroupExtras }: Props) {
  const items: Item[] = [
    ...(starosta
      ? [{ id: 'starosta', title: 'Правки группы', icon: EditIcon, render: () => <StarostaPage group={starosta} onExtras={onGroupExtras} /> }]
      : []),
    {
      id: 'group-schedule',
      title: 'Расписание группы',
      icon: SearchIcon,
      render: () => <GroupSchedulePage prefs={prefs} onPrefsChange={onPrefsChange} />,
    },
    { id: 'teacher-schedule', title: 'Расписание преподавателя', icon: TeacherIcon, render: () => <TeacherSchedulePage /> },
    { id: 'rooms', title: 'Свободные аудитории', icon: DoorIcon, render: () => <FreeRoomsPage /> },
    { id: 'teachers', title: 'Преподаватели', icon: StarIcon, render: () => <TeachersPage /> },
    { id: 'board', title: 'Чат', icon: ChatIcon, render: () => <BoardPage />, dot: boardNew },
    ...(teacherMode
      ? []
      : [
          { id: 'session', title: 'Сессия', icon: ExamIcon, render: () => <SessionPage group={group} /> },
          { id: 'calendar', title: 'Календарь на телефоне', icon: PhoneCalendarIcon, render: () => <CalendarPage group={group} /> },
        ]),
    { id: 'groupbot', title: 'Бот в беседе группы', icon: GroupChatIcon, render: () => <GroupBotPage /> },
  ]
  const [openId, setOpenId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpenId(null)
    window.scrollTo(0, 0)
  }, [])
  // только у владельца: у остальных ни пункта, ни намёка (права всё равно проверяет бот)
  if (admin) items.push({ id: 'admin', title: 'Админ-панель', icon: ShieldIcon, render: () => <AdminPage onExit={close} />, bare: true })
  useBackButton(openId ? close : null)

  const open = items.find((item) => item.id === openId)
  if (open?.bare) return open.render()
  if (open) {
    return (
      <div className="screen more">
        <header className="page-head">
          <button type="button" className="page-back" onClick={close} aria-label="Назад">
            <ChevronLeft /> Ещё
          </button>
          <h2 className="page-title">{open.title}</h2>
        </header>
        {open.render()}
      </div>
    )
  }

  return (
    <div className="screen more">
      <h2 className="more-title">Ещё</h2>
      <Section>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="row row-btn row-nav"
            onClick={() => {
              haptic()
              setOpenId(item.id)
              if (item.id === 'board') onBoardOpen()
              window.scrollTo(0, 0)
            }}
          >
            <span className="row-icon">
              <item.icon />
            </span>
            <span className="row-label">{item.title}</span>
            {item.dot && <span className="new-dot" aria-label="есть новое" />}
            <ChevronRight className="row-chevron" />
          </button>
        ))}
      </Section>
    </div>
  )
}
