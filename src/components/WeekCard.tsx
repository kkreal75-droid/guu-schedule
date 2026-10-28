import { isEvenWeek } from '../../shared/format-core'
import { formatDays } from '../format'
import { ChevronLeft, ChevronRight } from '../icons'
import { t } from '../i18n'

// Неделя над днями: «8 неделя, чётная · 19–25 октября» и стрелки ‹ › по бокам. monday — начало недели.
type Props = {
  week: number
  monday: number
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

export function WeekCard({ week, monday, onPrev, onNext, prevDisabled, nextDisabled }: Props) {
  return (
    <div className="week-nav">
      <button type="button" className="week-arrow" aria-label={t('Предыдущая неделя')} disabled={prevDisabled} onClick={onPrev}>
        <ChevronLeft />
      </button>
      <span className="week-title">
        {isEvenWeek(week) ? t('{n} неделя, чётная', { n: week }) : t('{n} неделя, нечётная', { n: week })} · {formatDays(monday, monday + 6)}
      </span>
      <button type="button" className="week-arrow" aria-label={t('Следующая неделя')} disabled={nextDisabled} onClick={onNext}>
        <ChevronRight />
      </button>
    </div>
  )
}
