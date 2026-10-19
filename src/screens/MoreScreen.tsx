import { useCallback, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { Section } from '../components/Section'
import { BoardPage } from '../board/BoardPage'
import { BoardIcon, ChevronLeft, ChevronRight, GroupChatIcon, PhoneCalendarIcon } from '../icons'
import { CalendarPage } from '../more/CalendarPage'
import { GroupBotPage } from '../more/GroupBotPage'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'

// «Ещё» — всё дополнительное, чтобы не мешать расписанию. Каждый пункт — своя страница.
type Item = {
  id: string
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  render: () => ReactNode // элемент, а не компонент: иначе при перерисовке страница сбрасывала бы состояние
  dot?: boolean
}

// boardNew — точка «есть новое» на доске; onBoardOpen — человек зашёл на доску, точку убрать
type Props = { admin: boolean; group: string; boardNew: boolean; onBoardOpen: () => void }

export function MoreScreen({ admin, group, boardNew, onBoardOpen }: Props) {
  const items: Item[] = [
    { id: 'board', title: 'Доска', icon: BoardIcon, render: () => <BoardPage group={group} />, dot: boardNew },
    { id: 'calendar', title: 'Календарь на телефоне', icon: PhoneCalendarIcon, render: () => <CalendarPage group={group} /> },
    { id: 'groupbot', title: 'Бот в беседе группы', icon: GroupChatIcon, render: () => <GroupBotPage /> },
  ]
  void admin // пункт «Админ-панель» появится на этапе 6

  const [openId, setOpenId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpenId(null)
    window.scrollTo(0, 0)
  }, [])
  useBackButton(openId ? close : null)

  const open = items.find((item) => item.id === openId)
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
