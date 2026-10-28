import { WEEK_INDEXES, dateOf, formatDate, weekdayFull, weekdayShort } from '../format'
import { getLang, t } from '../i18n'

// Дни недели сеткой: выбранный — плашка цвета акцента, сегодня — цвет акцента, воскресенье серое;
// под числом точки: есть пары, есть заметка
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
          data-sunday={i === 6 || undefined}
          onClick={() => onPick(i)}
        >
          <span className="day-wd">{getLang() === 'ru' ? weekdayShort(i).toLowerCase() : weekdayShort(i)}</span>
          <span className="day-num">{dateOf(monday + i).date}</span>
          <span className="day-dots" aria-hidden="true">
            {busy[i] && <span className="day-dot" />}
            {notes?.[i] && <span className="day-dot day-dot-note" />}
          </span>
        </button>
      ))}
    </div>
  )
}
