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

// служебные значки: стрелка ‹ 10×17, шеврон › 8×13, галочка 17×13, крестик очистки поля
export const ChevronLeft = (p: P) => (
  <svg {...base} width={10} height={17} viewBox="0 0 10 17" strokeWidth={2.2} {...p}>
    <path d="M8.5 1.5l-7 7 7 7" />
  </svg>
)

export const ChevronRight = (p: P) => (
  <svg {...base} width={8} height={13} viewBox="0 0 8 13" {...p}>
    <path d="M1.5 1.5l5 5-5 5" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base} width={17} height={13} viewBox="0 0 17 13" strokeWidth={2.2} {...p}>
    <path d="M1.5 7l4.5 4.5L15.5 1.5" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
