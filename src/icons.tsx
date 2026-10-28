import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

// Линейные иконки: сетка 24×24, линия 2, скруглённые концы, цвет — currentColor
const PATHS = {
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4" />
    </>
  ),
  'calendar-lines': (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4M7.5 14h4M14 14h2.5M7.5 17.2h9" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.3 8.7l-1.9 4.7-4.7 1.9 1.9-4.7Z" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20.2c.9-3.6 3.8-5.7 7.2-5.7s6.3 2.1 7.2 5.7" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.6" r="3.3" />
      <path d="M2.8 19.6c.8-3.1 3.2-4.9 6.2-4.9s5.4 1.8 6.2 4.9" />
      <path d="M15.4 5.5a3 3 0 0 1 0 6M17.2 14.9c1.9.5 3.3 2 3.9 4.4" />
    </>
  ),
  note: (
    <>
      <path d="M11.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4.5" />
      <path d="M17.4 3.9a1.8 1.8 0 0 1 2.6 2.6l-7.4 7.4-3.3.7.7-3.3Z" />
    </>
  ),
  pencil: (
    <>
      <path d="M15.6 4.6a2.1 2.1 0 0 1 3 3L8.3 17.9l-4 1.2 1.2-4Z" />
      <path d="M13.8 6.4l3 3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
      <path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5M8.5 10.5h7M8.5 14h7M8.5 17.5h4" />
    </>
  ),
  door: (
    <>
      <path d="M6.5 20.5V5A1.5 1.5 0 0 1 8 3.5h8A1.5 1.5 0 0 1 17.5 5v15.5M4 20.5h16" />
      <path d="M14 12.2v.6" />
    </>
  ),
  document: (
    <>
      <path d="M13.5 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V9Z" />
      <path d="M13.5 3.5V9H19M8.5 13h7M8.5 16.5h5" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6" />
      <path d="M10.5 18h3" />
    </>
  ),
  star: <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8Z" />,
  ticket: (
    <>
      <path d="M3.8 8A1.5 1.5 0 0 1 5.3 6.5h13.4A1.5 1.5 0 0 1 20.2 8v2.2a1.9 1.9 0 0 0 0 3.6V16a1.5 1.5 0 0 1-1.5 1.5H5.3A1.5 1.5 0 0 1 3.8 16v-2.2a1.9 1.9 0 0 0 0-3.6Z" />
      <path d="M14.5 6.8v1.4M14.5 11.3v1.4M14.5 15.8v1.4" />
    </>
  ),
  chat: <path d="M20 11.6a7.6 7.6 0 0 1-11.1 6.7L4.2 19.6l1.3-4.4A7.6 7.6 0 1 1 20 11.6Z" />,
  building: (
    <>
      <path d="M5 20.5V7l7-3.5L19 7v13.5M3 20.5h18M10 20.5v-4.5h4v4.5" />
      <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.7 9.4a2.4 2.4 0 0 1 4.6.9c0 1.7-2.3 2.1-2.3 3.7M12 16.9h.01" />
    </>
  ),
  download: <path d="M12 3.8v11.4M7.4 10.8 12 15.4l4.6-4.6M5 20h14" />,
  pin: <path d="M9 3.5h6M10.2 3.5v5.3L7.4 12.2h9.2l-2.8-3.4V3.5M12 12.2v8.3" />,
  'eye-off': (
    <path d="M3.5 3.5l17 17M10.4 6.2c.5-.1 1-.2 1.6-.2 4.9 0 8.2 4.2 9.2 6-.4.8-1.3 2.2-2.6 3.5M6.5 7.6C4.6 8.9 3.3 10.8 2.8 12c1 1.8 4.3 6 9.2 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  ),
  cap: (
    <>
      <path d="M2.6 9.2 12 4.8l9.4 4.4L12 13.6Z" />
      <path d="M6.6 11.1v4.4c0 1.3 2.4 2.9 5.4 2.9s5.4-1.6 5.4-2.9v-4.4M21.4 9.2v5" />
    </>
  ),
  board: <path d="M3.5 4.5h17M5 4.5v9.8A1.7 1.7 0 0 0 6.7 16h10.6a1.7 1.7 0 0 0 1.7-1.7V4.5M12 16v3.8M8.6 20.3h6.8" />,
  repeat: (
    <>
      <path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4" />
      <path d="M19.8 4.6v4.6h-4.6" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7.2 7.5 5.6 7.5-5.6" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10.2v3.6A1.2 1.2 0 0 0 5.2 15H7l7 4.2V4.8L7 9H5.2A1.2 1.2 0 0 0 4 10.2Z" />
      <path d="M17.6 9a4 4 0 0 1 0 6" />
    </>
  ),
  shield: <path d="M12 3.4 5.2 6v5.6c0 4.2 2.8 7.4 6.8 8.9 4-1.5 6.8-4.7 6.8-8.9V6Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2M12 3.4c2.2 2.4 3.3 5.3 3.3 8.6s-1.1 6.2-3.3 8.6c-2.2-2.4-3.3-5.3-3.3-8.6s1.1-6.2 3.3-8.6Z" />
    </>
  ),
  chart: <path d="M4 20.5h16M7 17v-5M12 17V6.5M17 17v-8" />,
  sliders: (
    <>
      <path d="M4 7.5h9M17.5 7.5H20M4 16.5h3M11.5 16.5H20" />
      <circle cx="15.2" cy="7.5" r="2.2" />
      <circle cx="9.2" cy="16.5" r="2.2" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.9 3.9 0 0 0 5.6 0l3-3a3.9 3.9 0 0 0-5.6-5.6l-1.1 1.1" />
      <path d="M13.8 10.2a3.9 3.9 0 0 0-5.6 0l-3 3a3.9 3.9 0 0 0 5.6 5.6l1.1-1.1" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 20.6s6.6-5.7 6.6-11a6.6 6.6 0 0 0-13.2 0c0 5.3 6.6 11 6.6 11Z" />
      <circle cx="12" cy="9.6" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3 2" />
    </>
  ),
  thumb: (
    <>
      <path d="M7.5 10.6v9.1H5.2a1.5 1.5 0 0 1-1.5-1.5v-6.1a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M7.5 10.6 11 3.9a2 2 0 0 1 3 2.3l-.9 3.4h5a2 2 0 0 1 2 2.4l-1.3 6.1a2 2 0 0 1-2 1.6H7.5" />
    </>
  ),
  dumbbell: <path d="M6.6 7.5v9M17.4 7.5v9M3.8 10v4M20.2 10v4M6.6 12h10.8" />,
  cup: (
    <>
      <path d="M4.8 9h11.4v4.8a5 5 0 0 1-5 5h-1.4a5 5 0 0 1-5-5Z" />
      <path d="M16.2 10.4h1.4a2.4 2.4 0 0 1 0 4.8h-1.4M8.6 3.8v2.6M12.4 3.8v2.6" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.6C10.3 5.3 7.9 4.6 4.5 4.6v13c3.4 0 5.8.7 7.5 2 1.7-1.3 4.1-2 7.5-2v-13c-3.4 0-5.8.7-7.5 2Z" />
      <path d="M12 6.6v13" />
    </>
  ),
  bolt: <path d="M13.2 3.4 5.6 13.1h6.2l-1 7.5 7.6-9.7h-6.2Z" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.6 15.6l4.6 4.6" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  'arrow-up-right': <path d="M7 17 17 7M9 7h8v8" />,
}

export type IconName = keyof typeof PATHS

// <Icon name="calendar" /> — 22 px, линия 2; в нижнем меню 25 px
export function Icon({ name, size = 22, strokeWidth = 2, ...p }: { name: IconName; size?: number; strokeWidth?: number } & P) {
  return (
    <svg {...line} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...p}>
      {PATHS[name]}
    </svg>
  )
}

// «···» — меню пары и другие действия
export const MoreIcon = (p: P) => (
  <svg width={17} height={4} viewBox="0 0 17 4" fill="currentColor" aria-hidden="true" {...p}>
    <circle cx="1.75" cy="2" r="1.75" />
    <circle cx="8.5" cy="2" r="1.75" />
    <circle cx="15.25" cy="2" r="1.75" />
  </svg>
)

// служебные значки: стрелка ‹ 9×15, шеврон › 7×12, стрелка вниз 12×8 (дата в шапке) и 10×6 (сортировка),
// галочка 16×12, крестик очистки поля
export const ChevronLeft = (p: P) => (
  <svg {...line} width={9} height={15} viewBox="0 0 10 17" strokeWidth={1.9} {...p}>
    <path d="M8.5 1.5l-7 7 7 7" />
  </svg>
)

export const ChevronRight = (p: P) => (
  <svg {...line} width={7} height={12} viewBox="0 0 8 13" strokeWidth={1.8} {...p}>
    <path d="M1.5 1.5l5 5-5 5" />
  </svg>
)

export const ChevronDown = (p: P) => (
  <svg {...line} width={12} height={8} viewBox="0 0 12 8" strokeWidth={1.9} {...p}>
    <path d="M1.5 1.5 6 6l4.5-4.5" />
  </svg>
)

export const ChevronDownSmall = (p: P) => (
  <svg {...line} width={10} height={6} viewBox="0 0 10 6" strokeWidth={1.6} {...p}>
    <path d="M1 1l4 4 4-4" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...line} width={16} height={12} viewBox="0 0 17 13" strokeWidth={2} {...p}>
    <path d="M1.5 7l4.5 4.5L15.5 1.5" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...line} width={24} height={24} viewBox="0 0 24 24" strokeWidth={2} {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
)
