import { useCallback, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { AdminPage } from '../admin/AdminPage'
import type { TeacherInfo } from '../data'
import type { Extras } from '../edits'
import {
  BoltIcon, BuildingIcon, ChevronLeft, ChevronRight, DoorIcon, DownloadIcon, EditIcon, ExamIcon, GlobeIcon, GroupChatIcon,
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
import { InternationalPage } from '../more/InternationalPage'
import { EventsPage } from '../more/EventsPage'
import { KugPage } from '../more/KugPage'
import { PlacesPage, type PlacesTarget } from '../more/PlacesPage'
import { SessionPage } from '../more/SessionPage'
import { StarostaPage } from '../more/StarostaPage'
import { SupportPage } from '../more/SupportPage'
import { TeacherSchedulePage } from '../more/TeacherSchedulePage'
import { TeachersPage } from '../more/TeachersPage'
import { haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t, useLang } from '../i18n'

// «Другое» — всё, кроме расписания: группы-карточки (Учебное, Сообщество, Информация, Помощь), у пункта —
// цветная иконка, название и серая подпись. У старосты — «Правки группы», у владельца — «Админ-панель».
// В английском интерфейсе первым — «For international students» (этап 11.4).

type Color = 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'teal' | 'sky' | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray'
type Item = {
  id: string
  title: string
  sub?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  color: Color
  render?: () => ReactNode // элемент, а не компонент: иначе при перерисовке страница сбрасывала бы состояние
  action?: () => void // вместо страницы (ссылка)
  bare?: boolean // страница рисует свою шапку (у админ-панели вложенные разделы)
}
type Group = { title?: string; items: Item[] }

// group — группа на экране расписания; teacherMode — роль «Преподаватель» (сессия и календарь — для групп);
// channel — ссылка «Канал новостей» из админки (избранное — из контекста, src/favorites.tsx)
type Props = {
  admin: boolean
  group: string
  teacherMode: boolean
  extras: Extras
  starosta: string | null // староста этой группы — «Правки группы»
  onGroupExtras: (group: string, extras: Extras) => void
  channel?: string | null
  // открыть пункт сразу (нажали преподавателя в паре): «Назад» вернёт на расписание
  request?: MoreRequest | null
  onRequestBack?: () => void
}

// session — кнопка «Открыть расписание сессии» из рассылки бота (?open=session); group-schedule — нажали группу
// у пары преподавателя
export type MoreRequest =
  | { item: 'teachers'; teacher: TeacherInfo }
  | ({ item: 'places' } & PlacesTarget)
  | { item: 'session' }
  | { item: 'group-schedule'; group: string }

export function MoreScreen({
  admin, group, teacherMode, starosta, onGroupExtras, channel, request,
  onRequestBack,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(request?.item ?? null)
  const close = useCallback(() => {
    if (request && onRequestBack) return onRequestBack()
    setOpenId(null)
    window.scrollTo(0, 0)
  }, [request, onRequestBack])

  const lang = useLang()
  const groups: Group[] = [
    ...(lang === 'en'
      ? [
          {
            items: [
              {
                id: 'international',
                title: 'For international students',
                sub: 'Weeks, buildings, visas, contacts',
                icon: GlobeIcon,
                color: 'teal' as Color,
                render: () => <InternationalPage onOpen={(item) => (setOpenId(item), window.scrollTo(0, 0))} />,
              },
            ],
          },
        ]
      : []),
    {
      title: t('Учебное'),
      items: [
        ...(teacherMode
          ? []
          : [{ id: 'session', title: t('Расписание сессии'), sub: t('Экзамены и зачёты'), icon: ExamIcon, color: 'red' as Color, render: () => <SessionPage group={group} /> }]),
        { id: 'kug', title: t('Календарный учебный график'), sub: t('Сессии, каникулы, праздники'), icon: PlanIcon, color: 'orange', render: () => <KugPage group={group} /> },
        { id: 'teacher-schedule', title: t('Расписание преподавателя'), sub: t('Поиск по фамилии'), icon: TeacherIcon, color: 'purple', render: () => <TeacherSchedulePage /> },
        {
          id: 'group-schedule',
          title: t('Расписание группы'),
          sub: t('Любая группа ГУУ'),
          icon: PeopleIcon,
          color: 'blue',
          render: () => <GroupSchedulePage initial={request?.item === 'group-schedule' ? request.group : undefined} />,
        },
        { id: 'rooms', title: t('Свободные аудитории'), sub: t('Где посидеть между парами'), icon: DoorIcon, color: 'teal', render: () => <FreeRoomsPage /> },
        { id: 'documents', title: t('Документы'), sub: t('Таблицы с расписанием'), icon: TableIcon, color: 'sky', render: () => <DocumentsPage group={group} /> },
        ...(teacherMode
          ? []
          : [{ id: 'calendar', title: t('Календарь на телефоне'), sub: 'Apple / Google Calendar', icon: PhoneCalendarIcon, color: 'amber' as Color, render: () => <CalendarPage group={group} /> }]),
      ],
    },
    {
      title: t('Сообщество'),
      items: [
        {
          id: 'teachers',
          title: t('Рейтинг преподавателей'),
          sub: t('Отзывы и оценки'),
          icon: StarIcon,
          color: 'yellow',
          render: () => (
            <TeachersPage
              initial={request?.item === 'teachers' ? request.teacher : undefined}
              onClose={request ? onRequestBack : undefined}
              group={teacherMode ? undefined : group}
            />
          ),
        },
        { id: 'events', title: t('Мероприятия ГУУ'), sub: t('Проектное обучение, Make.Events'), icon: BoltIcon, color: 'pink', render: () => <EventsPage /> },
        { id: 'groupbot', title: t('Бот в беседе группы'), sub: t('Расписание в чат каждое утро'), icon: GroupChatIcon, color: 'indigo', render: () => <GroupBotPage /> },
      ],
    },
    {
      title: t('Информация'),
      items: [
        {
          id: 'places',
          title: t('Корпуса ГУУ'),
          sub: t('Адреса и карта'),
          icon: BuildingIcon,
          color: 'green',
          render: () => <PlacesPage target={request?.item === 'places' ? request : undefined} />,
        },
        { id: 'faq', title: t('Частые вопросы'), icon: QuestionIcon, color: 'blue', render: () => <FaqPage /> },
        { id: 'install', title: t('Установить приложение'), sub: t('На домашний экран'), icon: DownloadIcon, color: 'sky', render: () => <InstallPage /> },
      ],
    },
    {
      title: t('Помощь'),
      items: [
        { id: 'support', title: t('Написать в поддержку'), sub: t('Ошибка, идея, вопрос'), icon: MessageIcon, color: 'blue', render: () => <SupportPage /> },
        ...(channel
          ? [{ id: 'channel', title: t('Канал новостей'), sub: t('Что нового в приложении'), icon: MegaphoneIcon, color: 'green' as Color, action: () => openTelegramLink(channel) }]
          : []),
      ],
    },
  ]
  // у старосты и владельца — отдельной карточкой внизу (остальным ни пункта, ни намёка; права проверяет бот)
  const special: Item[] = [
    ...(starosta
      ? [{ id: 'starosta', title: t('Правки группы'), sub: t('Отмены, переносы, подгруппы'), icon: EditIcon, color: 'orange' as Color, render: () => <StarostaPage group={starosta} onExtras={onGroupExtras} /> }]
      : []),
    ...(admin ? [{ id: 'admin', title: t('Админ-панель'), sub: t('Только для владельца'), icon: ShieldIcon, color: 'gray' as Color, render: () => <AdminPage onExit={close} />, bare: true }] : []),
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
          <button type="button" className="page-back" onClick={close} aria-label={t('Назад')}>
            <ChevronLeft /> {request ? t('Расписание') : t('Другое')}
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
        <h1 className="screen-title">{t('Другое')}</h1>
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
                <ChevronRight className="other-chevron" />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
