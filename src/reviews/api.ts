// Запросы рейтинга преподавателей к боту (bot/src/reviews.ts). Авторы отзывов анонимны — их видит только
// владелец (author, grp, reports приходят только ему).
import { ApiError, callBot } from '../api'

export type Review = {
  id: number
  rating: number
  text: string
  discipline: string | null
  at: number
  edited: boolean
  mine: boolean
  hidden: boolean // скрыт после 3 жалоб — видят только автор и владелец
  author?: { id: number; name: string | null; username: string | null }
  grp?: string | null
  reports?: number
}

export type TeacherCard = {
  teacher: string
  count: number
  average: number | null // только от 3 отзывов
  distribution: number[] // сколько оценок 1, 2, 3, 4, 5
  reviews: Review[]
  mine: Review | null
  can_review: boolean
  reason: string | null // почему нельзя оставить отзыв
  banned_until: number | null
  contact: string | null // @ник владельца
  limits: { text_min: number; text_max: number }
}

// t — id преподавателя, n — отзывов, avg — средняя (null, если отзывов меньше 3)
export type Rated = { t: string; n: number; avg: number | null }

export type ReviewDraft = { rating: number; text: string; discipline: string | null; confirm: boolean }

export const reviewsApi = {
  top: () => callBot<{ teachers: Rated[] }>('/reviews/top'),
  teacher: (teacher: string) => callBot<TeacherCard>('/reviews/teacher', { teacher }),
  save: (teacher: string, draft: ReviewDraft) => callBot<TeacherCard>('/reviews/save', { teacher, ...draft }),
  remove: (teacher: string) => callBot<TeacherCard>('/reviews/delete', { teacher }),
  report: (id: number) => callBot('/reviews/report', { id }),
}

// Текст ошибки для человека: бот присылает готовую фразу (или код)
export function reviewError(err: unknown): string {
  if (!(err instanceof ApiError) || err.status === 0) return 'Нет связи. Попробуй ещё раз.'
  if (err.code && /[а-яё]/i.test(err.code)) return err.code
  return 'Что-то сломалось 🛠'
}

export const formatAverage = (avg: number) => avg.toFixed(1).replace('.', ',')

export function reviewsWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'отзыв'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'отзыва'
  return 'отзывов'
}
