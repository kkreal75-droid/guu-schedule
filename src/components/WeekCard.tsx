import { isEvenWeek } from '../../shared/format-core'
import { MONTHS_NOM, dateOf, formatShortRange } from '../format'
import { ChevronLeft, ChevronRight } from '../icons'

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
      <button type="button" className="round-btn" aria-label="Предыдущая неделя" disabled={prevDisabled} onClick={onPrev}>
        <ChevronLeft />
      </button>
      <div className="week-card-title">
        <span className="week-card-month">{MONTHS_NOM[dateOf(day).month]}</span>
        <span className="week-card-parity">{isEvenWeek(week) ? 'Чётная' : 'Нечётная'}</span>
        <span className="week-card-range">
          {formatShortRange(monday, monday + 6)} · {week}-я неделя
        </span>
      </div>
      <button type="button" className="round-btn" aria-label="Следующая неделя" disabled={nextDisabled} onClick={onNext}>
        <ChevronRight />
      </button>
    </div>
  )
}
