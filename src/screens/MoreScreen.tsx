import { useCallback, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { AdminPage } from '../admin/AdminPage'
import { BoardPage } from '../board/BoardPage'
import type { TeacherInfo } from '../data'
import type { Extras } from '../edits'
import {
  ChatIcon, ChevronLeft, ChevronRight, DoorIcon, DownloadIcon, EditIcon, ExamIcon, GroupChatIcon,
  MegaphoneIcon, MessageIcon, PeopleIcon, PhoneCalendarIcon, PlanIcon, QuestionIcon, ShieldIcon, StarIcon, TableIcon,
  TeacherIcon,
} from '../icons'
import { CalendarPage } from '../more/CalendarPage'
import { DocumentsPage } from '../more/DocumentsPage'
import { FaqPage } from '../more/FaqPage'
import { FreeRoomsPage } from '../more/FreeRoomsPage'
import { GroupBotPage } from '../more/GroupBotPage'
import { GroupSchedulePage } from '../more/GroupSchedulePage'
import { InstallPage } from '../more/InstallPage'
import { KugPage } from '../more/KugPage'
import { SessionPage } from '../more/SessionPage'
import { StarostaPage } from '../more/StarostaPage'
import { SupportPage } from '../more/SupportPage'
import { TeacherSchedulePage } from '../more/TeacherSchedulePage'
import { TeachersPage } from '../more/TeachersPage'
import type { Prefs } from '../prefs'
import { haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'

// «Другое» — всё, кроме расписания: группы-карточки (Учебное, Сообщество, Информация, Помощь), у пункта —
// цветная иконка, название и серая подпись. У старосты — «Правки группы», у владельца — «Админ-панель».

type Color = 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'teal' | 'sky' | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray'
type Item = {
  id: string
  title: string
  sub?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  color: Color
  render?: () => ReactNode // элемент, а не компонент: иначе при перерисовке страница сбрасывала бы состояние
  action?: () => void // вместо страницы (ссылка)
  dot?: boolean
  bare?: boolean // страница рисует свою шапку (у админ-панели вложенные разделы)
}
type Group = { title?: string; items: Item[] }

// group — группа на экране расписания; teacherMode — роль «Преподаватель» (сессия и календарь — для групп);
// boardNew — точка «есть новое» в Подслушано; onBoardOpen — человек зашёл туда, точку убрать;
// prefs / onPrefsChange — избранные группы; channel — ссылка «Канал новостей» из админки
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
  channel?: string | null
  // открыть пункт сразу (нажали преподавателя в паре): «Назад» вернёт на расписание
  request?: MoreRequest | null
  onRequestBack?: () => void
}

export type MoreRequest = { item: 'teachers'; teacher: TeacherInfo }

export function MoreScreen({
  admin, group, teacherMode, boardNew, onBoardOpen, prefs, onPrefsChange, starosta, onGroupExtras, channel, request,
  onRequestBack,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(request?.item ?? null)
  const close = useCallback(() => {
    if (request && onRequestBack) return onRequestBack()
    setOpenId(null)
    window.scrollTo(0, 0)
  }, [request, onRequestBack])

  const groups: Group[] = [
    {
      title: 'Учебное',
      items: [
        ...(teacherMode
          ? []
          : [{ id: 'session', title: 'Расписание сессии', sub: 'Экзамены и зачёты', icon: ExamIcon, color: 'red' as Color, render: () => <SessionPage group={group} /> }]),
        { id: 'kug', title: 'Календарный учебный график', sub: 'Учебный план семестра', icon: PlanIcon, color: 'orange', render: () => <KugPage group={group} /> },
        { id: 'teacher-schedule', title: 'Расписание преподавателя', sub: 'Поиск по фамилии', icon: TeacherIcon, color: 'purple', render: () => <TeacherSchedulePage /> },
        {
          id: 'group-schedule',
          title: 'Расписание группы',
          sub: 'Любая группа ГУУ',
          icon: PeopleIcon,
          color: 'blue',
          render: () => <GroupSchedulePage prefs={prefs} onPrefsChange={onPrefsChange} />,
        },
        { id: 'rooms', title: 'Свободные аудитории', sub: 'Где посидеть между парами', icon: DoorIcon, color: 'teal', render: () => <FreeRoomsPage /> },
        { id: 'documents', title: 'Документы', sub: 'Таблицы с расписанием', icon: TableIcon, color: 'sky', render: () => <DocumentsPage group={group} /> },
        ...(teacherMode
          ? []
          : [{ id: 'calendar', title: 'Календарь на телефоне', sub: 'Apple / Google Calendar', icon: PhoneCalendarIcon, color: 'amber' as Color, render: () => <CalendarPage group={group} /> }]),
      ],
    },
    {
      title: 'Сообщество',
      items: [
        {
          id: 'teachers',
          title: 'Рейтинг преподавателей',
          sub: 'Отзывы и оценки',
          icon: StarIcon,
          color: 'yellow',
          render: () => <TeachersPage initial={request?.teacher} onClose={request ? onRequestBack : undefined} />,
        },
        { id: 'board', title: 'Подслушано', sub: 'Анонимный чат ГУУ', icon: ChatIcon, color: 'pink', render: () => <BoardPage />, dot: boardNew },
        { id: 'groupbot', title: 'Бот в беседе группы', sub: 'Расписание в чат каждое утро', icon: GroupChatIcon, color: 'indigo', render: () => <GroupBotPage /> },
      ],
    },
    {
      title: 'Информация',
      items: [
        { id: 'faq', title: 'Частые вопросы', icon: QuestionIcon, color: 'blue', render: () => <FaqPage /> },
        { id: 'install', title: 'Установить приложение', sub: 'На домашний экран', icon: DownloadIcon, color: 'sky', render: () => <InstallPage /> },
      ],
    },
    {
      title: 'Помощь',
      items: [
        { id: 'support', title: 'Написать в поддержку', sub: 'Ошибка, идея, вопрос', icon: MessageIcon, color: 'blue', render: () => <SupportPage /> },
        ...(channel
          ? [{ id: 'channel', title: 'Канал новостей', sub: 'Что нового в приложении', icon: MegaphoneIcon, color: 'green' as Color, action: () => openTelegramLink(channel) }]
          : []),
      ],
    },
  ]
  // у старосты и владельца — отдельной карточкой внизу (остальным ни пункта, ни намёка; права проверяет бот)
  const special: Item[] = [
    ...(starosta
      ? [{ id: 'starosta', title: 'Правки группы', sub: 'Отмены, переносы, подгруппы', icon: EditIcon, color: 'orange' as Color, render: () => <StarostaPage group={starosta} onExtras={onGroupExtras} /> }]
      : []),
    ...(admin ? [{ id: 'admin', title: 'Админ-панель', sub: 'Только для владельца', icon: ShieldIcon, color: 'gray' as Color, render: () => <AdminPage onExit={close} />, bare: true }] : []),
  ]
  if (special.length) groups.push({ items: special })

  const all = groups.flatMap((g) => g.items)
  useBackButton(openId ? close : null)

  const open = all.find((item) => item.id === openId)
  if (open?.bare) return open.render!()
  if (open?.render) {
    return (
      <div className="screen more">
        <header className="page-head">
          <button type="button" className="page-back" onClick={close} aria-label="Назад">
            <ChevronLeft /> {request ? 'Расписание' : 'Другое'}
          </button>
          <h2 className="page-title">{open.title}</h2>
        </header>
        {open.render()}
      </div>
    )
  }

  return (
    <div className="screen other">
      <header className="screen-head">
        <h1 className="screen-title">Другое</h1>
      </header>
      <div className="other-body">
        {groups.map((g, i) => (
          <section key={g.title ?? i} className="other-group">
            {g.title && <h3 className="other-group-title">{g.title}</h3>}
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="other-row"
                onClick={() => {
                  haptic()
                  if (item.action) return item.action()
                  setOpenId(item.id)
                  if (item.id === 'board') onBoardOpen()
                  window.scrollTo(0, 0)
                }}
              >
                <span className={`other-icon ic-${item.color}`}>
                  <item.icon />
                </span>
                <span className="other-text">
                  <span className="other-title">{item.title}</span>
                  {item.sub && <span className="other-sub">{item.sub}</span>}
                </span>
                {item.dot && <span className="new-dot" aria-label="есть новое" />}
                <ChevronRight className="other-chevron" />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
