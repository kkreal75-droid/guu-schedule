import { PlusIcon, StarFillIcon } from '../icons'
import { groupName } from '../schedule'
import { haptic } from '../telegram'

// Над расписанием: своя группа (★), пара МБ 1-1 / 1-2 и избранные; «+» — добавить группу в избранное.
// Чипы прокручиваются, если не влезают.
type Props = {
  value: string
  groups: string[]
  home?: string
  onChange: (group: string) => void
  onAdd?: () => void
}

export function GroupChips({ value, groups, home, onChange, onAdd }: Props) {
  return (
    <div className="chips-bar">
      <div className="chips-scroll" role="radiogroup" aria-label="Группа">
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={g === value}
            className="group-chip"
            onClick={() => {
              if (g === value) return
              haptic()
              onChange(g)
            }}
          >
            {g === home && <StarFillIcon className="group-chip-star" aria-label="своя группа" />}
            {groupName(g)}
          </button>
        ))}
        {onAdd && (
          <button type="button" className="group-chip group-chip-add" aria-label="Добавить группу в избранное" onClick={onAdd}>
            <PlusIcon />
          </button>
        )}
      </div>
    </div>
  )
}
