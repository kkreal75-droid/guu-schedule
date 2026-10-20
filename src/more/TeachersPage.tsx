import { useCallback, useEffect, useMemo, useState } from 'react'
import { teacherKey } from '../../shared/schedule-core'
import { botAvailable } from '../api'
import { useNotice } from '../board/common'
import { Section } from '../components/Section'
import { Segmented } from '../components/Segmented'
import { loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { ChevronLeft, ChevronRight } from '../icons'
import {
  formatAverage, reviewError, reviewsApi, reviewsWord, type Rated, type Review, type ReviewDraft, type TeacherCard,
} from '../reviews/api'
import { confirmAction, haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { ScheduleViewer } from './ScheduleViewer'

// «Ещё → Преподаватели»: поиск по фамилии, оценки студентов (★ — от 3 отзывов), карточка с отзывами.
// Отзыв оставляют только студенты, у чьей группы преподаватель ведёт (или вёл в прошлом семестре)
// пары — это проверяет бот. Авторы анонимны.

type Sort = 'rating' | 'count' | 'name'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'rating', label: 'По оценке' },
  { value: 'count', label: 'По отзывам' },
  { value: 'name', label: 'А–Я' },
]

const RULES = 'Оценивай преподавание, а не личность. Без оскорблений, мата, слухов и личных данных. Отзывы с нарушениями удаляются, за повтор — бан.'

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

// initial — сразу открыть карточку (нажали преподавателя в паре); onClose — «Назад» из неё (на расписание)
export function TeachersPage({ initial, onClose }: { initial?: TeacherInfo; onClose?: () => void } = {}) {
  const [list, setList] = useState<TeacherInfo[] | null>(null)
  const [rated, setRated] = useState<Map<string, Rated>>(new Map())
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('rating')
  const [open, setOpen] = useState<TeacherInfo | null>(initial ?? null)

  const loadRated = useCallback(() => {
    if (!botAvailable()) return
    reviewsApi.top().then((r) => setRated(new Map(r.teachers.map((t) => [t.t, t]))), () => {})
  }, [])
  const load = useCallback(() => {
    setError(false)
    loadTeachers().then((d) => setList(d.teachers), () => setError(true))
    loadRated()
  }, [loadRated])
  useEffect(load, [load])

  const close = useCallback(() => {
    if (initial && onClose) return onClose()
    setOpen(null)
    loadRated() // мог оставить отзыв — обновим числа в списке
    window.scrollTo(0, 0)
  }, [loadRated, initial, onClose])
  useBackButton(open && !(initial && onClose) ? close : null)

  const shown = useMemo(() => {
    if (!list) return []
    const found = query.trim().length >= 2 ? searchTeachers(list, query, 50) : list.filter((t) => rated.has(t.id))
    const avg = (t: TeacherInfo) => rated.get(t.id)?.avg ?? -1
    const count = (t: TeacherInfo) => rated.get(t.id)?.n ?? 0
    const byName = (a: TeacherInfo, b: TeacherInfo) => a.name.localeCompare(b.name, 'ru')
    return [...found].sort((a, b) =>
      sort === 'name' ? byName(a, b)
      : sort === 'count' ? count(b) - count(a) || avg(b) - avg(a) || byName(a, b)
      : avg(b) - avg(a) || count(b) - count(a) || byName(a, b),
    )
  }, [list, query, rated, sort])

  // открыли из расписания — «Назад» в шапке страницы и так ведёт туда
  if (open) return <TeacherView teacher={open} onBack={close} backLabel={initial && onClose ? null : 'Все преподаватели'} />
  if (error) {
    return (
      <div className="ob-hero">
        <p className="ob-text">Не получилось загрузить список преподавателей.</p>
        <button type="button" className="button-secondary" onClick={load}>
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className="gsearch">
      <input
        className="input gsearch-input"
        type="search"
        placeholder="Фамилия преподавателя"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Фамилия преподавателя"
      />
      <Segmented label="Сортировка" value={sort} options={SORTS} onChange={setSort} />
      {!list && <p className="gsearch-empty">Загружаю…</p>}
      {list && query.trim().length >= 2 && !shown.length && <p className="gsearch-empty">Не нашёл такую фамилию в расписании ГУУ.</p>}
      {list && query.trim().length < 2 && !shown.length && (
        <p className="gsearch-empty">Отзывов пока нет. Найди своего преподавателя по фамилии — и оставь первый.</p>
      )}
      {shown.length > 0 && (
        <div className="section-body gsearch-list">
          {shown.map((t) => {
            const r = rated.get(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className="row row-btn gsearch-row"
                onClick={() => {
                  haptic()
                  setOpen(t)
                  window.scrollTo(0, 0)
                }}
              >
                <span className="gsearch-text">
                  <span className="gsearch-name">{t.name}</span>
                  <span className="gsearch-sub">
                    {t.subjects.slice(0, 2).join(', ')}
                    {t.subjects.length > 2 ? ` и ещё ${t.subjects.length - 2}` : ''}
                  </span>
                </span>
                {r && (
                  <span className="teacher-score">
                    {r.avg !== null ? `${formatAverage(r.avg)} ★ · ${r.n}` : `${r.n} ${reviewsWord(r.n)}`}
                  </span>
                )}
                <ChevronRight className="row-chevron" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- карточка преподавателя ----------

function TeacherView({ teacher, onBack, backLabel }: { teacher: TeacherInfo; onBack: () => void; backLabel: string | null }) {
  const [card, setCard] = useState<TeacherCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'card' | 'form' | 'schedule'>('card')
  const [notice, flash] = useNotice()

  useEffect(() => {
    if (!botAvailable()) return
    reviewsApi.teacher(teacher.id).then(setCard, (err) => setError(reviewError(err)))
  }, [teacher.id])

  const toCard = useCallback(() => {
    setMode('card')
    window.scrollTo(0, 0)
  }, [])
  useBackButton(mode !== 'card' ? toCard : null)

  const back =
    mode === 'card' && !backLabel ? null : (
      <button type="button" className="page-back admin-sub-back" onClick={mode === 'card' ? onBack : toCard}>
        <ChevronLeft /> {mode === 'card' ? backLabel : teacher.name}
      </button>
    )

  if (mode === 'schedule') {
    return (
      <>
        {back}
        <ScheduleViewer
          id={teacherKey(teacher.id)}
          actions={
            <div className="viewer-head">
              <div className="viewer-title">
                <span className="viewer-name">{teacher.name}</span>
                <span className="viewer-sub">Расписание по файлам ГУУ · у пар — группы</span>
              </div>
            </div>
          }
        />
      </>
    )
  }

  if (mode === 'form' && card) {
    return (
      <>
        {back}
        <ReviewForm
          teacher={teacher}
          card={card}
          onSaved={(next) => {
            setCard(next)
            toCard()
            flash('Отзыв сохранён. Спасибо!')
            haptic('light')
          }}
        />
      </>
    )
  }

  const remove = async () => {
    if (!(await confirmAction('Удалить свой отзыв?'))) return
    try {
      setCard(await reviewsApi.remove(teacher.id))
      flash('Отзыв удалён')
    } catch (err) {
      flash(reviewError(err))
    }
  }

  const report = async (review: Review) => {
    if (!(await confirmAction('Пожаловаться на отзыв? Его проверят.'))) return
    try {
      await reviewsApi.report(review.id)
      flash('Жалоба отправлена. Спасибо!')
    } catch (err) {
      flash(reviewError(err))
    }
  }

  const banned = Boolean(card?.banned_until && card.banned_until > Date.now())
  const others = card?.reviews.filter((r) => !r.mine) ?? []

  return (
    <>
      {back}
      <div className="viewer-head">
        <div className="viewer-title">
          <span className="viewer-name">{teacher.name}</span>
          {teacher.subjects.length > 0 && <span className="viewer-sub">{teacher.subjects.join(' · ')}</span>}
        </div>
        <div className="viewer-actions">
          <button type="button" className="chip chip-accent" onClick={() => (haptic(), setMode('schedule'), window.scrollTo(0, 0))}>
            Расписание преподавателя
          </button>
        </div>
      </div>

      {notice && <p className="board-notice">{notice}</p>}
      {!botAvailable() && <p className="lead">Отзывы работают в Telegram — откройте расписание там.</p>}
      {error && <p className="lead">{error}</p>}
      {botAvailable() && !card && !error && <p className="lead">Загружаю отзывы…</p>}

      {card && (
        <>
          <RatingSummary card={card} />

          {card.mine ? (
            <Section title="Мой отзыв" footer={card.mine.hidden ? 'Скрыт после жалоб — ждёт проверки.' : 'Видят все, но без имени и группы.'}>
              <ReviewItem review={card.mine} />
              <div className="row row-chips review-own-actions">
                {!banned && (
                  <button type="button" className="chip chip-accent" onClick={() => (haptic(), setMode('form'), window.scrollTo(0, 0))}>
                    Изменить
                  </button>
                )}
                <button type="button" className="chip chip-danger" onClick={remove}>
                  Удалить
                </button>
              </div>
            </Section>
          ) : banned ? (
            <p className="lead">Тебе запрещено писать отзывы.</p>
          ) : card.can_review ? (
            <button type="button" className="button-primary" onClick={() => (haptic(), setMode('form'), window.scrollTo(0, 0))}>
              Оставить отзыв
            </button>
          ) : (
            card.reason && <p className="section-footer review-reason">{card.reason}</p>
          )}

          <Section title={others.length ? `Отзывы · ${others.length}` : 'Отзывы'}>
            {others.length === 0 && <div className="row row-text">Пока никто не написал</div>}
            {others.map((r) => (
              <ReviewItem key={r.id} review={r} onReport={banned ? undefined : () => report(r)} />
            ))}
          </Section>

          {card.contact && (
            <p className="section-footer review-contact">
              Вы преподаватель и не согласны с отзывом? Напишите{' '}
              <button type="button" className="link-btn" onClick={() => openTelegramLink(`https://t.me/${card.contact!.slice(1)}`)}>
                {card.contact}
              </button>
            </p>
          )}
        </>
      )}
    </>
  )
}

function RatingSummary({ card }: { card: TeacherCard }) {
  const max = Math.max(1, ...card.distribution)
  return (
    <div className="rating">
      <div className="rating-main">
        {card.average !== null ? (
          <span className="rating-value">
            {formatAverage(card.average)} <span className="rating-star">★</span>
          </span>
        ) : (
          <span className="rating-few">Мало отзывов</span>
        )}
        <span className="rating-count">
          {card.count} {reviewsWord(card.count)}
        </span>
      </div>
      {card.count > 0 && (
        <div className="rating-bars">
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="rating-bar">
              <span className="rating-bar-label">{n} ★</span>
              <span className="rating-bar-track">
                <span className="rating-bar-fill" style={{ width: `${(card.distribution[n - 1] / max) * 100}%` }} />
              </span>
              <span className="rating-bar-count">{card.distribution[n - 1]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const dateLabel = (at: number) => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

function ReviewItem({ review, onReport }: { review: Review; onReport?: () => void }) {
  return (
    <div className={`review${review.hidden ? ' is-hidden' : ''}`}>
      <div className="review-head">
        <span className="review-stars" aria-label={`Оценка ${review.rating} из 5`}>
          {stars(review.rating)}
        </span>
        <span className="review-date">
          {dateLabel(review.at)}
          {review.edited ? ' · изменён' : ''}
        </span>
      </div>
      {review.discipline && <div className="review-discipline">{review.discipline}</div>}
      <p className="review-text">{review.text}</p>
      {review.author && (
        <div className="review-admin">
          {review.author.username ? `@${review.author.username}` : (review.author.name ?? `id ${review.author.id}`)} · id {review.author.id}
          {review.grp ? ` · ${review.grp}` : ''}
          {review.reports ? ` · жалоб: ${review.reports}` : ''}
          {review.hidden ? ' · скрыт' : ''}
        </div>
      )}
      {onReport && (
        <button type="button" className="link-btn review-report" onClick={onReport}>
          Пожаловаться
        </button>
      )}
    </div>
  )
}

// ---------- форма отзыва ----------

function ReviewForm({ teacher, card, onSaved }: { teacher: TeacherInfo; card: TeacherCard; onSaved: (card: TeacherCard) => void }) {
  const [draft, setDraft] = useState<ReviewDraft>({
    rating: card.mine?.rating ?? 0,
    text: card.mine?.text ?? '',
    discipline: card.mine?.discipline ?? null,
    confirm: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { text_min: min, text_max: max } = card.limits
  const length = [...draft.text.trim()].length
  const ready = draft.rating > 0 && length >= min && length <= max && draft.confirm
  const set = (patch: Partial<ReviewDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await reviewsApi.save(teacher.id, { ...draft, text: draft.text.trim() }))
    } catch (err) {
      setError(reviewError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="review-rules">{RULES}</p>
      <Section title={card.mine ? 'Изменить отзыв' : 'Новый отзыв'}>
        <div className="form">
          <div className="field">
            <span>Оценка</span>
            <div className="star-picker" role="radiogroup" aria-label="Оценка">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={draft.rating === n}
                  aria-label={`${n} из 5`}
                  className={`star-btn${n <= draft.rating ? ' is-on' : ''}`}
                  onClick={() => (haptic(), set({ rating: n }))}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {teacher.subjects.length > 0 && (
            <div className="field">
              <span>Дисциплина (необязательно)</span>
              <div className="row-chips">
                {teacher.subjects.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={draft.discipline === s}
                    onClick={() => set({ discipline: draft.discipline === s ? null : s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="field">
            <span>Отзыв</span>
            <textarea
              className="input textarea"
              rows={6}
              value={draft.text}
              maxLength={max + 50}
              placeholder="Как объясняет, как принимает работы, что понравилось и что нет"
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
          <p className="form-hint">
            {length < min ? `Ещё хотя бы ${min - length} симв.` : `${length} / ${max}`}
          </p>

          <label className="check-row">
            <input type="checkbox" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
            <span>Отзыв основан на моём опыте</span>
          </label>

          {error && <p className="form-error">{error}</p>}
          <button type="button" className="button-primary" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Отправляю…' : card.mine ? 'Сохранить' : 'Отправить'}
          </button>
        </div>
      </Section>
    </>
  )
}
