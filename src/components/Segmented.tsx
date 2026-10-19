import { haptic } from '../telegram'

type Props<T extends string> = {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: Props<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="segmented-item"
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
