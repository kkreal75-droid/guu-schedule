import { useCallback, useState, type ReactNode } from 'react'
import { AdminPage } from '../admin/AdminPage'
import { Row, type Tone } from '../components/Row'
import type { IconName } from '../icons'
import type { TeacherInfo } from '../data'
import type { Extras } from '../edits'
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

// «Сервисы» — всё, кроме расписания: списки по группам (Учёба, Сообщество, Информация, Помощь), у пункта —
// тонкая иконка, название и серая подпись. У старосты — «Правки группы», у владельца — «Админ-панель».
// В английском интерфейсе первым — «For international students» (этап 11.4).

type Item = {
  id: string
  title: string
  sub?: string
  icon: IconName
  tone: Tone
  render?: () => ReactNode // элемент, а не компонент: иначе при перерисовке страница сбрасывала бы состояние
  action?: () => void // вместо страницы (ссылка)
  bare?: boolean // страница рисует свою шапку (у админ-панели вложенные разделы)
  ownTitle?: boolean // страница рисует свой заголовок (расписание преподавателя и группы — фамилия, название)
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
  | { item: 'events' }

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
                icon: 'globe' as const,
                tone: 'blue' as const,
                render: () => <InternationalPage onOpen={(item) => (setOpenId(item), window.scrollTo(0, 0))} />,
              },
            ],
          },
        ]
      : []),
    {
      title: t('Учёба'),
      items: [
        ...(teacherMode
          ? []
          : [{ id: 'session', title: t('Расписание сессии'), sub: t('Экзамены и зачёты'), icon: 'clipboard' as const, tone: 'violet' as const, render: () => <SessionPage group={group} /> }]),
        { id: 'kug', title: t('Учебный график'), sub: t('Сессии, каникулы, праздники'), icon: 'calendar-lines', tone: 'blue', render: () => <KugPage group={group} /> },
        { id: 'teacher-schedule', title: t('Расписание преподавателя'), sub: t('Поиск по фамилии'), icon: 'person', tone: 'teal', ownTitle: true, render: () => <TeacherSchedulePage /> },
        {
          id: 'group-schedule',
          title: t('Расписание группы'),
          sub: t('Любая группа ГУУ'),
          icon: 'people',
          tone: 'indigo',
          ownTitle: true,
          render: () => <GroupSchedulePage initial={request?.item === 'group-schedule' ? request.group : undefined} />,
        },
        { id: 'rooms', title: t('Свободные аудитории'), sub: t('Где посидеть между парами'), icon: 'door', tone: 'green', render: () => <FreeRoomsPage /> },
        { id: 'documents', title: t('Документы'), sub: t('Таблицы с сайта ГУУ'), icon: 'document', tone: 'slate', render: () => <DocumentsPage group={group} /> },
        ...(teacherMode
          ? []
          : [{ id: 'calendar', title: t('Календарь на телефоне'), sub: t('Apple и Google'), icon: 'phone' as const, tone: 'coral' as const, render: () => <CalendarPage group={group} /> }]),
      ],
    },
    {
      title: t('Сообщество'),
      items: [
        {
          id: 'teachers',
          title: t('Рейтинг преподавателей'),
          sub: t('Отзывы и оценки'),
          icon: 'star',
          tone: 'amber',
          ownTitle: true,
          render: () => (
            <TeachersPage
              initial={request?.item === 'teachers' ? request.teacher : undefined}
              onClose={request ? onRequestBack : undefined}
              group={teacherMode ? undefined : group}
            />
          ),
        },
        { id: 'events', title: t('Мероприятия ГУУ'), sub: t('Проектное обучение, Make.Events'), icon: 'ticket', tone: 'rose', render: () => <EventsPage /> },
        { id: 'groupbot', title: t('Бот в беседе группы'), sub: t('Расписание в чат каждое утро'), icon: 'chat', tone: 'blue', render: () => <GroupBotPage /> },
      ],
    },
    {
      title: t('Информация'),
      items: [
        {
          id: 'places',
          title: t('Корпуса ГУУ'),
          sub: t('Адреса и карта'),
          icon: 'building',
          tone: 'teal',
          render: () => <PlacesPage target={request?.item === 'places' ? request : undefined} />,
        },
        { id: 'faq', title: t('Частые вопросы'), icon: 'question', tone: 'violet', render: () => <FaqPage /> },
        { id: 'install', title: t('Установить приложение'), sub: t('На домашний экран'), icon: 'download', tone: 'indigo', ownTitle: true, render: () => <InstallPage /> },
      ],
    },
    {
      title: t('Помощь'),
      items: [
        { id: 'support', title: t('Написать в поддержку'), sub: t('Ошибка, идея, вопрос'), icon: 'mail', tone: 'coral', render: () => <SupportPage /> },
        ...(channel
          ? [{ id: 'channel', title: t('Канал новостей'), sub: t('Что нового в приложении'), icon: 'megaphone' as const, tone: 'amber' as const, action: () => openTelegramLink(channel) }]
          : []),
      ],
    },
  ]
  // у старосты и владельца — отдельной карточкой внизу (остальным ни пункта, ни намёка; права проверяет бот)
  const special: Item[] = [
    ...(starosta
      ? [{ id: 'starosta', title: t('Правки группы'), sub: t('Отмены, переносы, подгруппы'), icon: 'pencil' as const, tone: 'amber' as const, render: () => <StarostaPage group={starosta} onExtras={onGroupExtras} /> }]
      : []),
    ...(admin ? [{ id: 'admin', title: t('Админ-панель'), sub: t('Только для владельца'), icon: 'shield' as const, tone: 'slate' as const, render: () => <AdminPage />, bare: true }] : []),
  ]
  if (special.length) groups.push({ items: special })

  const all = groups.flatMap((g) => g.items)
  useBackButton(openId ? close : null)

  const open = all.find((item) => item.id === openId)
  if (open?.bare) return open.render!()
  // вложенная страница: заголовок экрана, «Назад» — кнопкой Telegram в шапке
  if (open?.render) {
    return (
      <div className="screen more">
        {!open.ownTitle && <h1 className="page-title page-title-gap">{open.title}</h1>}
        {open.render()}
      </div>
    )
  }

  return (
    <div className="screen more">
      <h1 className="screen-title more-title">{t('Сервисы')}</h1>
      {groups.map((g, i) => (
        <section key={g.title ?? i} className="section more-group">
          {g.title && <h3 className="section-title">{g.title}</h3>}
          <div className="list">
            {g.items.map((item) => (
              <Row
                key={item.id}
                icon={item.icon}
                tone={item.tone}
                title={item.title}
                sub={item.sub}
                chevron
                onClick={() => {
                  haptic()
                  if (item.action) return item.action()
                  setOpenId(item.id)
                  window.scrollTo(0, 0)
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
