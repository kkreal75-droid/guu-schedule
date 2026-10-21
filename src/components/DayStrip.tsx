import { WEEK_INDEXES, dateOf, formatDate, weekdayFull, weekdayShort } from '../format'
import { t } from '../i18n'

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
    <div className="day-strip" role="tablist" aria-label={t('Дни недели')}>
      {WEEK_INDEXES.map((i) => (
        <button
          key={i}
          type="button"
          role="tab"
          className="day"
          aria-selected={i === weekday}
          aria-label={`${weekdayFull(i)}, ${formatDate(monday + i)}`}
          data-today={monday + i === today || undefined}
          onClick={() => onPick(i)}
        >
          <span className="day-wd">{weekdayShort(i)}</span>
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
