import { useCallback, useState, type ComponentType, type SVGProps } from 'react'
import { Section } from '../components/Section'
import { ChevronLeft, ChevronRight, GroupChatIcon } from '../icons'
import { GroupBotPage } from '../more/GroupBotPage'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'

// «Ещё» — всё дополнительное, чтобы не мешать расписанию. Каждый пункт — своя страница.
type Item = {
  id: string
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  page: ComponentType
  dot?: boolean
}

type Props = { admin: boolean }

export function MoreScreen({ admin }: Props) {
  const items: Item[] = [{ id: 'groupbot', title: 'Бот в беседе группы', icon: GroupChatIcon, page: GroupBotPage }]
  void admin // пункт «Админ-панель» появится на этапе 6

  const [openId, setOpenId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpenId(null)
    window.scrollTo(0, 0)
  }, [])
  useBackButton(openId ? close : null)

  const open = items.find((item) => item.id === openId)
  if (open) {
    const Page = open.page
    return (
      <div className="screen more">
        <header className="page-head">
          <button type="button" className="page-back" onClick={close} aria-label="Назад">
            <ChevronLeft /> Ещё
          </button>
          <h2 className="page-title">{open.title}</h2>
        </header>
        <Page />
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
