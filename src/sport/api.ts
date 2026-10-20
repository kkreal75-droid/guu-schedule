// «Спорт»: секции и занятия — GET /sport у бота (данные публичные); последняя копия — в localStorage
import type { SportData } from '../../shared/sport-core'
import { readLocal, writeLocal } from '../storage'
import { BOT_URL } from '../telegram'

const KEY = 'sport_cache'

export function cachedSport(): SportData | null {
  try {
    const raw = readLocal(KEY)
    return raw ? (JSON.parse(raw) as SportData) : null
  } catch {
    return null
  }
}

export async function loadSport(): Promise<SportData> {
  if (!BOT_URL) throw new Error('no bot')
  const res = await fetch(`${BOT_URL}/sport`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as SportData & { ok: boolean }
  const out: SportData = { sections: data.sections, sessions: data.sessions, updated_at: data.updated_at }
  writeLocal(KEY, JSON.stringify(out))
  return out
}
