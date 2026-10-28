import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// Короткое сообщение внизу раздела («Сохранено», ошибка) — само исчезает
export function useFlash(): [(text: string) => void, ReactNode] {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = useCallback((value: string) => {
    setText(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(null), 4000)
  }, [])
  return [flash, text ? <p className="admin-flash">{text}</p> : null]
}

// Загрузка данных раздела: data, ошибка и перезагрузка
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const loader = useRef(load)
  const reload = useCallback(() => {
    loader.current().then(
      (value) => {
        setData(value)
        setError(null)
      },
      (err) => setError(err),
    )
  }, [])
  useEffect(reload, [reload])
  return { data, setData, error, reload }
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

// Столбики без библиотек: высота — доля от максимума, подписи — несколько штук по оси
export function BarChart({ values, labels, every }: { values: number[]; labels: string[]; every: number }) {
  const max = Math.max(1, ...values)
  return (
    <div className="chart">
      <div className="chart-max">{max}</div>
      <div className="chart-bars">
        {values.map((v, i) => (
          <div key={i} className="chart-col" title={`${labels[i]}: ${v}`}>
            <div className="chart-bar" style={{ height: `${(v / max) * 100}%` }} data-zero={v === 0 || undefined} />
          </div>
        ))}
      </div>
      <div className="chart-axis">
        {labels.map((label, i) => (
          <span key={i}>{i % every === 0 ? label : ''}</span>
        ))}
      </div>
    </div>
  )
}

export const Loading = ({ error }: { error?: string | null }) => <p className="empty-note">{error ?? 'Загружаю…'}</p>
