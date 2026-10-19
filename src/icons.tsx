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
