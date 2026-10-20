import { groupName } from '../schedule'
import { haptic } from '../telegram'
import { Segmented } from './Segmented'

// Над расписанием: своя группа и избранные. Одна — просто название; две коротких — переключатель,
// как «1-1 / 1-2» у МБ; больше или длинные — прокручиваемые чипсы.
export function GroupSwitch({ value, groups, onChange }: { value: string; groups: string[]; onChange: (g: string) => void }) {
  if (groups.length <= 1) return <div className="group-title">{groupName(value)}</div>
  const options = groups.map((g) => ({ value: g, label: groupName(g) }))
  if (groups.length === 2 && options.every((o) => o.label.length <= 14)) {
    return <Segmented label="Группа" value={value} options={options} onChange={onChange} />
  }
  return (
    <div className="group-chips" role="radiogroup" aria-label="Группа">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="group-chip"
          onClick={() => {
            if (o.value === value) return
            haptic()
            onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
