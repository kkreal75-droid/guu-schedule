import { isEvenWeek } from '../../shared/format-core'
import { dateOf, formatShortRange, monthTitle } from '../format'
import { ChevronLeft, ChevronRight } from '../icons'
import { t } from '../i18n'

// Карточка недели над расписанием: месяц мелко, «Чётная / Нечётная» крупно, даты и номер недели,
// круглые стрелки по бокам. day — выбранный день (месяц берём от него), monday — начало недели.
type Props = {
  week: number
  day: number
  monday: number
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

export function WeekCard({ week, day, monday, onPrev, onNext, prevDisabled, nextDisabled }: Props) {
  return (
    <div className="week-card">
      <button type="button" className="round-btn" aria-label={t('Предыдущая неделя')} disabled={prevDisabled} onClick={onPrev}>
        <ChevronLeft />
      </button>
      <div className="week-card-title">
        <span className="week-card-month">{monthTitle(dateOf(day).month)}</span>
        <span className="week-card-parity">{isEvenWeek(week) ? t('Чётная') : t('Нечётная')}</span>
        <span className="week-card-range">
          {formatShortRange(monday, monday + 6)} · {t('{n}-я неделя', { n: week })}
        </span>
      </div>
      <button type="button" className="round-btn" aria-label={t('Следующая неделя')} disabled={nextDisabled} onClick={onNext}>
        <ChevronRight />
      </button>
    </div>
  )
}
