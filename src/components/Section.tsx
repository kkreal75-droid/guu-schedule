import type { ReactNode } from 'react'

// Блок в стиле настроек Telegram: заголовок, белая карточка со строками, подпись снизу
export function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {title && <h3 className="section-title">{title}</h3>}
      <div className="section-body">{children}</div>
      {footer && <p className="section-footer">{footer}</p>}
    </section>
  )
}
