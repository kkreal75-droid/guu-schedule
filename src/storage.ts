import { supports, tg } from './telegram'

// Хранилище «ключ → строка»: Telegram CloudStorage (синхронизируется между устройствами)
// + localStorage как быстрый локальный кэш и запасной вариант вне Telegram.
// Ограничения CloudStorage: ключ 1–128 символов [A-Za-z0-9_-], значение до 4096 символов.

export const cloudAvailable = () => supports('6.9')

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // приватный режим / квота — просто живём без кэша
  }
}

export function readCloud(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!cloudAvailable()) return resolve(null)
    try {
      tg!.CloudStorage.getItem(key, (err, value) => resolve(err || !value ? null : value))
    } catch {
      resolve(null)
    }
  })
}

// ---------- низкоуровневые вызовы CloudStorage в виде Promise ----------
// При ошибке, таймауте или вне Telegram: null / false — вызывающий код живёт на локальной копии.

const CLOUD_TIMEOUT_MS = 10_000 // если клиент так и не ответил, SDK сам колбэк не вызовет

function cloud<T>(call: (done: (err: string | null, result: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    if (!cloudAvailable()) return resolve(null)
    const timer = window.setTimeout(() => resolve(null), CLOUD_TIMEOUT_MS)
    try {
      call((err, result) => {
        window.clearTimeout(timer)
        resolve(err ? null : result)
      })
    } catch {
      window.clearTimeout(timer)
      resolve(null)
    }
  })
}

export const cloudKeys = () => cloud<string[]>((done) => tg!.CloudStorage.getKeys(done))

export async function cloudGetMany(keys: string[]): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {}
  // небольшими порциями, чтобы не упереться в размер одного запроса
  for (let i = 0; i < keys.length; i += 50) {
    const part = await cloud<Record<string, string>>((done) => tg!.CloudStorage.getItems(keys.slice(i, i + 50), done))
    if (!part) return null
    Object.assign(out, part)
  }
  return out
}

export const cloudSet = async (key: string, value: string) =>
  (await cloud<true>((done) => tg!.CloudStorage.setItem(key, value, done))) === true

export const cloudRemove = async (key: string) =>
  (await cloud<true>((done) => tg!.CloudStorage.removeItem(key, done))) === true

export function save(key: string, value: string) {
  writeLocal(key, value)
  if (!cloudAvailable()) return
  try {
    tg!.CloudStorage.setItem(key, value)
  } catch {
    // локальная копия уже сохранена
  }
}
