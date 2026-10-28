import { isEvenWeek } from '../../shared/format-core'
import { ChevronLeft, ChevronRight } from '../icons'
import { t } from '../i18n'

// Неделя над днями: «8 неделя, чётная» и стрелки ‹ › по бокам
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
      <span className="week-title">{isEvenWeek(week) ? t('{n} неделя, чётная', { n: week }) : t('{n} неделя, нечётная', { n: week })}</span>
      <button type="button" className="week-arrow" aria-label={t('Следующая неделя')} disabled={nextDisabled} onClick={onNext}>
        <ChevronRight />
      </button>
    </div>
  )
}
