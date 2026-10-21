// Запросы рейтинга преподавателей к боту (bot/src/reviews.ts). Авторы отзывов анонимны — их видит только
// владелец (author, grp, reports приходят только ему).
import { botError, callBot } from '../api'
import { tn } from '../i18n'

export type Criteria = { clarity: number; competence: number; communication: number }
export type Helpful = { up: number; down: number; mine: number } // mine: 1 / -1 / 0

export type Review = {
  id: number
  rating: number
  score: number // среднее критериев (у старых отзывов — rating)
  criteria: Criteria | null // null — старый отзыв с одной оценкой
  recommend: boolean | null
  helpful: Helpful
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
  criteria: (Record<keyof Criteria, number | null> & { count: number }) | null // средние по критериям, от 3
  recommend: number | null // % «рекомендуют»
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
export type Rated = { t: string; n: number; avg: number | null; rec: number | null }

export type ReviewDraft = Criteria & { recommend: boolean | null; text: string; discipline: string | null; confirm: boolean }

export const reviewsApi = {
  top: () => callBot<{ teachers: Rated[] }>('/reviews/top'),
  teacher: (teacher: string) => callBot<TeacherCard>('/reviews/teacher', { teacher }),
  save: (teacher: string, draft: ReviewDraft) => callBot<TeacherCard>('/reviews/save', { teacher, ...draft }),
  remove: (teacher: string) => callBot<TeacherCard>('/reviews/delete', { teacher }),
  report: (id: number) => callBot('/reviews/report', { id }),
  vote: (id: number, value: number) => callBot<{ id: number; helpful: Helpful }>('/reviews/vote', { id, value }),
}

// Текст ошибки для человека: бот присылает готовую фразу (или код) — на языке интерфейса
export const reviewError = (err: unknown): string => botError(err)

export const formatAverage = (avg: number) => avg.toFixed(1).replace('.', ',')

export const reviewsWord = (n: number): string => tn(n, 'отзыв|отзыва|отзывов')
