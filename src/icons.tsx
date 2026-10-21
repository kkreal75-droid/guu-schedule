import type { SVGProps } from 'react'

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

type P = SVGProps<SVGSVGElement>

export const CalendarIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
)

export const UserIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </svg>
)

export const PinIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
)

export const PersonIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="7.5" r="3.5" />
    <path d="M5.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
  </svg>
)

export const ChevronLeft = (p: P) => (
  <svg {...base} {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
)

export const ChevronRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

export const NoteIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14.5 4.5 19.5 9.5 9 20H4v-5L14.5 4.5Z" />
    <path d="m12.5 6.5 5 5" />
  </svg>
)

export const PlusIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const ExternalIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h4" />
  </svg>
)

export const MoreIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
)

export const GroupChatIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5.5h16a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    <path d="M8 10h8M8 13.5h5" />
  </svg>
)

export const PhoneCalendarIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M9 9h6M9 12.5h6M9 16h3" />
  </svg>
)

export const ShieldIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

export const SendIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
)

// «⋯» на карточке пары — действия с парой
export const DotsIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="3" />
  </svg>
)

// перечёркнутый глаз: скрытые пары («Это не моя пара»)
export const EyeOffIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.4 3.8M6.6 6.6C4.6 7.9 3.1 9.9 2.5 12c1 2.8 4.5 7 9.5 7 1.9 0 3.6-.6 5-1.5" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const ReplyIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 7 4.5 12l5 5" />
    <path d="M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5V19" />
  </svg>
)

// звезда: рейтинг преподавателей
export const StarIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
  </svg>
)

// зачётка: сессия
export const ExamIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v3h3M9 11h6M9 15h6M9 19h3" />
  </svg>
)

// лупа: расписание любой группы
export const SearchIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

// преподаватель у доски
export const TeacherIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="7" r="3" />
    <path d="M3 21v-3a5 5 0 0 1 10 0v3M13 4h8v9h-6" />
  </svg>
)

// дверь: свободные аудитории
export const DoorIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 21h14M7 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
    <path d="M14 12h.01" />
  </svg>
)

// карандаш: правки группы (староста)
export const EditIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
)

// часы: таймер идущей пары
export const ClockIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13l2.5 2M9.5 3h5" />
  </svg>
)

// звёздочка «своя группа» (заливка)
export const StarFillIcon = (p: P) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path d="m12 3.2 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.6l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.2Z" />
  </svg>
)

// таблица: «Документы»
export const TableIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10" />
  </svg>
)

// календарь со строками: «Календарный учебный график»
export const PlanIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4M7.5 13.5h4M7.5 16.5h7" />
  </svg>
)

// двое: «Расписание группы»
export const PeopleIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5c.7-3.3 2.9-5 5.5-5s4.8 1.7 5.5 5" />
    <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.9M17.5 14.8c1.6.6 2.6 2.1 3 4.7" />
  </svg>
)

// здание: «Корпуса ГУУ»
export const BuildingIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M10.5 20.5v-3h3v3" />
  </svg>
)

// вопрос: «Частые вопросы»
export const QuestionIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.8-2.4 2.2-2.4 3.7M12 17h.01" />
  </svg>
)

// загрузка: «Установить приложение»
export const DownloadIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
)

// облачко: «Написать в поддержку»
export const MessageIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5Z" />
  </svg>
)

// рупор: «Канал новостей»
export const MegaphoneIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1ZM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
)
