import { WEEKDAYS_FULL, WEEKDAYS_SHORT, dateOf, formatDate } from '../format'

// Полоса Пн–Вс: дата, точка у дней с занятиями (и жёлтая — с заметкой), выбранный день — синяя плашка
type Props = {
  monday: number
  weekday: number
  today: number
  busy: boolean[]
  notes?: boolean[]
  onPick: (weekday: number) => void
}

export function DayStrip({ monday, weekday, today, busy, notes, onPick }: Props) {
  return (
    <div className="day-strip" role="tablist" aria-label="Дни недели">
      {WEEKDAYS_SHORT.map((label, i) => (
        <button
          key={label}
          type="button"
          role="tab"
          className="day"
          aria-selected={i === weekday}
          aria-label={`${WEEKDAYS_FULL[i]}, ${formatDate(monday + i)}`}
          data-today={monday + i === today || undefined}
          onClick={() => onPick(i)}
        >
          <span className="day-wd">{label}</span>
          <span className="day-num">{dateOf(monday + i).date}</span>
          <span className="day-dots">
            <span className="day-dot" data-on={busy[i] || undefined} />
            {notes?.[i] && <span className="day-dot day-dot-note" />}
          </span>
        </button>
      ))}
    </div>
  )
}
