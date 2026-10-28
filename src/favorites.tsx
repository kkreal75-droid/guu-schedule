// Избранное над расписанием (этап 12): группы и преподаватели («t-<id>») вперемешку, в порядке ленты. Хранится в
// настройках (устройство + облако Telegram, prefs.favorites) и у бота (D1, POST /favorites) — одинаково на всех
// устройствах. Держит App; страницы «Другого» берут его из контекста (★ В избранное).
import { createContext, useContext } from 'react'

export type Favorites = {
  home: string // своё расписание (★): группа или «t-<id>» у роли «Преподаватель»
  list: string[] // избранное по порядку (без своего)
  has: (id: string) => boolean // своё или в избранном
  add: (id: string) => void
  remove: (id: string) => void
  reorder: (list: string[]) => void
}

export const FavoritesContext = createContext<Favorites | null>(null)

// вне App (онбординг и т. п.) избранного нет — кнопки «★» не показываем
export const useFavorites = () => useContext(FavoritesContext)
