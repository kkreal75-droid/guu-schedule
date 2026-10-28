// Мероприятия проектного обучения с make.events (этап 13): data/events.json на сайте (update.py, раз в час).
// Грузим по требованию (день с «Проектным обучением», «Другое → Мероприятия ГУУ»), копия — в localStorage.
import { useEffect, useState } from 'react'
import type { EventsFile, MakeEvent } from '../shared/events-core'
import { cachedList } from './data'

export const loadEvents = cachedList<EventsFile>('events.json', 'events_file')

// null — грузится; 'error' — нет ни сети, ни копии
export function useEvents(): MakeEvent[] | null | 'error' {
  const [state, setState] = useState<MakeEvent[] | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    loadEvents().then(
      (file) => alive && setState(Array.isArray(file.events) ? file.events : []),
      () => alive && setState('error'),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}
