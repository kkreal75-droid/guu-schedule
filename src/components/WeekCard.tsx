import { isEvenWeek } from '../../shared/format-core'
import { ChevronLeft, ChevronRight } from '../icons'
import { t } from '../i18n'

// Неделя над днями: крупно «Нечётная», под ней «9 неделя»; по бокам круглые кнопки ‹ ›
type Props = {
  week: number
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

export function WeekCard({ week, onPrev, onNext, prevDisabled, nextDisabled }: Props) {
  return (
    <div className="week-nav">
      <button type="button" className="week-arrow" aria-label={t('Предыдущая неделя')} disabled={prevDisabled} onClick={onPrev}>
        <ChevronLeft />
      </button>
      <span className="week-title">
        <span className="week-parity">{isEvenWeek(week) ? t('Чётная') : t('Нечётная')}</span>
        <span className="week-no">{t('{n} неделя', { n: week })}</span>
      </span>
      <button type="button" className="week-arrow" aria-label={t('Следующая неделя')} disabled={nextDisabled} onClick={onNext}>
        <ChevronRight />
      </button>
    </div>
  )
}
