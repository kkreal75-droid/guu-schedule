import { useRef } from 'react'
import { CloseIcon } from '../icons'
import { t } from '../i18n'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
  autoFocus?: boolean
}

// Поле поиска: 🔎 слева, круглый крестик очистки справа
export function SearchField({ value, onChange, placeholder, label, autoFocus }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <label className="search">
      <span className="search-emoji" aria-hidden="true">
        🔎
      </span>
      <input
        ref={input}
        className="search-input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label={t('Очистить')}
          onClick={() => {
            onChange('')
            input.current?.focus()
          }}
        >
          <CloseIcon strokeWidth={4} />
        </button>
      )}
    </label>
  )
}
