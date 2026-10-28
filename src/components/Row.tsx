import type { ReactNode } from 'react'
import { CheckIcon, ChevronRight } from '../icons'

type Props = {
  emoji?: string // 21 px в колонке 28 px слева
  title: ReactNode
  sub?: ReactNode // подпись 13 px под заголовком
  value?: ReactNode // значение справа
  chevron?: boolean
  check?: boolean // выбранное — красная галочка
  onClick?: () => void
  lang?: string // данные ГУУ, что остаются русскими
  className?: string
  disabled?: boolean
}

// Строка списка: эмодзи, заголовок с подписью, значение справа, шеврон или галочка
export function Row({ emoji, title, sub, value, chevron, check, onClick, lang, className, disabled }: Props) {
  const inner = (
    <>
      {emoji && (
        <span className="row-emoji" aria-hidden="true">
          {emoji}
        </span>
      )}
      <span className="row-label">
        <span className="row-text" lang={lang}>
          {title}
        </span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {value !== undefined && value !== null && <span className="row-value">{value}</span>}
      {check && <CheckIcon className="row-check" />}
      {chevron && <ChevronRight className="row-chevron" />}
    </>
  )
  const cls = `row${onClick ? ' row-btn' : ''}${className ? ` ${className}` : ''}`
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-pressed={check || undefined}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
