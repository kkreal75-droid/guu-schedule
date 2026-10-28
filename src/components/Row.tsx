import type { ReactNode } from 'react'
import { CheckIcon, ChevronRight, Icon, type IconName } from '../icons'

// цвет иконки на светлой плашке (список «Сервисов»): мягкие тона, подобранные к бирюзовому акценту
export type Tone = 'teal' | 'green' | 'blue' | 'indigo' | 'violet' | 'amber' | 'coral' | 'rose' | 'slate'

type Props = {
  icon?: IconName // 22 px в колонке 26 px слева
  tone?: Tone // иконка цветная на светлой плашке
  title: ReactNode
  sub?: ReactNode // подпись 13 px под заголовком
  value?: ReactNode // значение справа
  out?: boolean // ↗ — ссылка наружу
  chevron?: boolean
  check?: boolean // выбранное — галочка цвета акцента
  onClick?: () => void
  lang?: string // данные ГУУ, что остаются русскими
  className?: string
  disabled?: boolean
}

// Строка списка: иконка, заголовок с подписью, значение справа, шеврон, ↗ или галочка
export function Row({ icon, tone, title, sub, value, out, chevron, check, onClick, lang, className, disabled }: Props) {
  const inner = (
    <>
      {icon && (
        <span className="row-icon" data-tone={tone}>
          <Icon name={icon} size={tone ? 20 : 22} />
        </span>
      )}
      <span className="row-label">
        <span className="row-text" lang={lang}>
          {title}
        </span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {value !== undefined && value !== null && <span className="row-value">{value}</span>}
      {out && <Icon name="arrow-up-right" size={18} strokeWidth={1.8} className="row-out" />}
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
