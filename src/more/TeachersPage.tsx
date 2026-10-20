import { useCallback, useEffect, useMemo, useState } from 'react'
import { teacherKey } from '../../shared/schedule-core'
import { botAvailable } from '../api'
import { useNotice } from '../notice'
import { Section } from '../components/Section'
import { loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { ChevronLeft, ChevronRight, SearchIcon } from '../icons'
import {
  formatAverage, reviewError, reviewsApi, reviewsWord, type Criteria, type Rated, type Review, type ReviewDraft, type TeacherCard,
} from '../reviews/api'
import { confirmAction, haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { ScheduleViewer } from './ScheduleViewer'

// «Другое → Рейтинг преподавателей» (этапы 6 и 7.6): общий рейтинг (поиск, фильтр, сортировка), карточка
// (средняя, три критерия полосками, % «рекомендуют», распределение 1–5, отзывы «Полезные / Новые», «Ещё N»),
// новый отзыв — три критерия + «Рекомендую / Не рекомендую». Авторы анонимны. Отзыв оставляют только
// студенты, у чьей группы преподаватель ведёт (или вёл в прошлом семестре) пары — это проверяет бот.

type Sort = 'rating' | 'count' | 'name'
const SORT_LABEL: Record<Sort, string> = { rating: 'По оценке ↓', count: 'По отзывам ↓', name: 'По алфавиту' }
const NEXT_SORT: Record<Sort, Sort> = { rating: 'count', count: 'name', name: 'rating' }
type Filter = 'all' | 'rated' | 'mine'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'rated', label: 'С оценкой' },
  { value: 'mine', label: 'Мои' },
]

const CRITERIA: { key: keyof Criteria; label: string }[] = [
  { key: 'clarity', label: 'Понятность' },
  { key: 'competence', label: 'Компетентность' },
  { key: 'communication', label: 'Коммуникация' },
]

const RULES = 'Оценивай преподавание, а не личность. Без оскорблений, мата, слухов и личных данных. Отзывы с нарушениями удаляются, за повтор — бан.'
const PAGE = 50
const REVIEWS_PAGE = 5

const letter = (name: string) => name.trim().slice(0, 1).toUpperCase()

export function Stars({ value, size = 'm' }: { value: number; size?: 's' | 'm' }) {
  return (
    <span className={`stars stars-${size}`} aria-label={`${formatAverage(value)} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="star" data-on={value >= n - 0.25 || undefined}>
          ★
        </span>
      ))}
    </span>
  )
}

type TeacherWithPast = TeacherInfo & { past_groups?: string[] }

// initial — сразу открыть карточку (нажали преподавателя в паре); onClose — «Назад» из неё (на расписание);
// group — своя группа (фильтр «Мои»)
export function TeachersPage({ initial, onClose, group }: { initial?: TeacherInfo; onClose?: () => void; group?: string } = {}) {
  const [list, setList] = useState<TeacherWithPast[] | null>(null)
  const [rated, setRated] = useState<Map<string, Rated>>(new Map())
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('rating')
  const [filter, setFilter] = useState<Filter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)
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
    const avg = (t: TeacherInfo) => rated.get(t.id)?.avg ?? -1
    const count = (t: TeacherInfo) => rated.get(t.id)?.n ?? 0
    const byName = (a: TeacherInfo, b: TeacherInfo) => a.name.localeCompare(b.name, 'ru')
    let found: TeacherWithPast[] = query.trim().length >= 2 ? searchTeachers(list, query, 200) : list
    if (filter === 'rated') found = found.filter((t) => rated.get(t.id)?.avg != null)
    if (filter === 'mine' && group) found = found.filter((t) => t.groups.includes(group) || t.past_groups?.includes(group))
    return [...found].sort((a, b) =>
      sort === 'name' ? byName(a, b)
      : sort === 'count' ? count(b) - count(a) || avg(b) - avg(a) || byName(a, b)
      : avg(b) - avg(a) || count(b) - count(a) || byName(a, b),
    )
  }, [list, query, rated, sort, filter, group])

  if (open) {
    // открыли из расписания — «Назад» в шапке страницы и так ведёт туда
    return <TeacherView teacher={open} onBack={close} backLabel={initial && onClose ? null : 'Все преподаватели'} />
  }
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
    <div className="rating-page">
      <div className="rating-search">
        <label className="search-field">
          <SearchIcon />
          <input
            type="search"
            placeholder="Поиск по фамилии…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))}
            aria-label="Фамилия преподавателя"
          />
        </label>
        <button
          type="button"
          className="round-btn rating-filter-btn"
          aria-label="Фильтр"
          aria-expanded={filtersOpen}
          data-on={filter !== 'all' || undefined}
          onClick={() => (haptic(), setFiltersOpen((v) => !v))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        </button>
      </div>
      {filtersOpen && (
        <div className="row-chips rating-filters" role="radiogroup" aria-label="Фильтр">
          {FILTERS.filter((f) => f.value !== 'mine' || group).map((f) => (
            <button
              key={f.value}
              type="button"
              className="chip"
              role="radio"
              aria-pressed={filter === f.value}
              onClick={() => (haptic(), setFilter(f.value), setLimit(PAGE))}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="rating-meta">
        <span>
          {filter === 'mine' ? 'Преподаватели твоей группы' : 'Общий рейтинг'} · {list ? shown.length : '…'}
        </span>
        <button type="button" className="rating-sort" onClick={() => (haptic(), setSort(NEXT_SORT[sort]))}>
          {SORT_LABEL[sort]}
        </button>
      </div>

      {!list && <p className="gsearch-empty">Загружаю…</p>}
      {list && !shown.length && (
        <p className="gsearch-empty">{query.trim().length >= 2 ? 'Не нашёл такую фамилию в расписании ГУУ.' : 'Никого нет.'}</p>
      )}
      <div className="rating-list">
        {shown.slice(0, limit).map((t, i) => {
          const r = rated.get(t.id)
          return (
            <button key={t.id} type="button" className="rating-card" onClick={() => (haptic(), setOpen(t), window.scrollTo(0, 0))}>
              {sort !== 'name' && r?.avg != null && <span className="rating-rank">{i + 1}</span>}
              <span className="letter-avatar">{letter(t.name)}</span>
              <span className="rating-card-text">
                <span className="rating-card-name">{t.name}</span>
                {r?.avg != null ? (
                  <span className="rating-card-score">
                    <Stars value={r.avg} size="s" /> <b>{formatAverage(r.avg)}</b>
                  </span>
                ) : (
                  <span className="rating-card-sub">{r ? 'мало отзывов' : t.subjects[0]}</span>
                )}
              </span>
              <span className="rating-card-right">
                {r && (
                  <span className="rating-card-count">
                    {r.n} {reviewsWord(r.n)}
                    {r.rec != null && <span className="rec-pct"> · {r.rec}%</span>}
                  </span>
                )}
                <ChevronRight className="row-chevron" />
              </span>
            </button>
          )
        })}
      </div>
      {shown.length > limit && (
        <button type="button" className="button-secondary" onClick={() => setLimit((l) => l + PAGE)}>
          Показать ещё
        </button>
      )}
    </div>
  )
}

// ---------- карточка преподавателя ----------

function TeacherView({ teacher, onBack, backLabel }: { teacher: TeacherInfo; onBack: () => void; backLabel: string | null }) {
  const [card, setCard] = useState<TeacherCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'card' | 'form' | 'schedule'>('card')
  const [order, setOrder] = useState<'useful' | 'new'>('useful')
  const [limit, setLimit] = useState(REVIEWS_PAGE)
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

  // «Полезно» / «Не полезно»: повторное нажатие снимает отметку
  const vote = async (review: Review, value: number) => {
    haptic()
    const next = review.helpful.mine === value ? 0 : value
    try {
      const res = await reviewsApi.vote(review.id, next)
      setCard((c) => (c ? { ...c, reviews: c.reviews.map((r) => (r.id === review.id ? { ...r, helpful: res.helpful } : r)) } : c))
    } catch (err) {
      flash(reviewError(err))
    }
  }

  const banned = Boolean(card?.banned_until && card.banned_until > Date.now())
  const useful = (r: Review) => r.helpful.up - r.helpful.down
  const others = (card?.reviews.filter((r) => !r.mine) ?? []).sort((a, b) =>
    order === 'new' ? b.at - a.at : useful(b) - useful(a) || b.at - a.at,
  )
  const goForm = () => (haptic(), setMode('form'), window.scrollTo(0, 0))

  return (
    <>
      {back}
      <div className="teacher-hero">
        <div className="teacher-hero-top">
          <span className="letter-avatar letter-avatar-l">{letter(teacher.name)}</span>
          <div className="teacher-hero-text">
            <h2 className="teacher-hero-name">{teacher.name}</h2>
            {card?.average != null ? (
              <span className="rating-card-score">
                <Stars value={card.average} /> <b className="teacher-hero-avg">{formatAverage(card.average)}</b>
              </span>
            ) : (
              <span className="rating-card-sub">{card ? 'Мало отзывов' : ' '}</span>
            )}
          </div>
          {card && card.count > 0 && (
            <span className="rating-card-count">
              {card.count} {reviewsWord(card.count)}
              {card.recommend != null && <span className="rec-pct"> · {card.recommend}%</span>}
            </span>
          )}
        </div>
        {card?.criteria && (
          <div className="criteria">
            {CRITERIA.map((c) => (
              <div key={c.key} className="criteria-row">
                <span className="criteria-label">{c.label}</span>
                <span className="rating-bar-track">
                  <span className="rating-bar-fill" style={{ width: `${((card.criteria![c.key] ?? 0) / 5) * 100}%` }} />
                </span>
                <span className="criteria-value">{formatAverage(card.criteria![c.key] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {card && card.recommend != null && <p className="teacher-hero-rec">{card.recommend}% рекомендуют</p>}
        {card && card.count > 0 && <Distribution card={card} />}
        {teacher.subjects.length > 0 && <p className="viewer-sub">{teacher.subjects.join(' · ')}</p>}
        <div className="viewer-actions">
          <button type="button" className="chip chip-accent" onClick={() => (haptic(), setMode('schedule'), window.scrollTo(0, 0))}>
            Расписание преподавателя
          </button>
        </div>
      </div>

      {notice && <p className="notice-toast">{notice}</p>}
      {!botAvailable() && <p className="lead">Отзывы работают в Telegram — откройте расписание там.</p>}
      {error && <p className="lead">{error}</p>}
      {botAvailable() && !card && !error && <p className="lead">Загружаю отзывы…</p>}

      {card && (
        <>
          {card.mine ? (
            <Section title="Мой отзыв" footer={card.mine.hidden ? 'Скрыт после жалоб — ждёт проверки.' : 'Видят все, но без имени и группы.'}>
              <ReviewItem review={card.mine} />
              <div className="row row-chips review-own-actions">
                {!banned && (
                  <button type="button" className="chip chip-accent" onClick={goForm}>
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
            <button type="button" className="button-primary" onClick={goForm}>
              Оставить отзыв
            </button>
          ) : (
            card.reason && <p className="section-footer review-reason">{card.reason}</p>
          )}

          <div className="reviews-head">
            <h3 className="section-title">
              Отзывы{others.length ? ` · ${others.length} ${reviewsWord(others.length)}` : ''}
            </h3>
            {others.length > 1 && (
              <button type="button" className="rating-sort" onClick={() => (haptic(), setOrder(order === 'useful' ? 'new' : 'useful'))}>
                {order === 'useful' ? 'Полезные' : 'Новые'} ↓
              </button>
            )}
          </div>
          {others.length === 0 && <div className="empty empty-s">Пока никто не написал</div>}
          <div className="reviews">
            {others.slice(0, limit).map((r) => (
              <ReviewItem
                key={r.id}
                review={r}
                onReport={banned ? undefined : () => report(r)}
                onVote={banned ? undefined : (v) => vote(r, v)}
              />
            ))}
          </div>
          {others.length > limit && (
            <button type="button" className="reviews-more" onClick={() => setLimit((l) => l + 10)}>
              Ещё {others.length - limit}
            </button>
          )}

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

function Distribution({ card }: { card: TeacherCard }) {
  const max = Math.max(1, ...card.distribution)
  return (
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
  )
}

const dateLabel = (at: number) => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

function ReviewItem({ review, onReport, onVote }: { review: Review; onReport?: () => void; onVote?: (value: number) => void }) {
  const [full, setFull] = useState(false)
  const long = review.text.length > 260
  return (
    <div className={`review${review.hidden ? ' is-hidden' : ''}`}>
      <div className="review-head">
        <span className="review-who">
          <span className="review-anon">{review.mine ? 'Ты' : 'Студент'}</span>
          {review.recommend !== null && (
            <span className={`rec-badge${review.recommend ? '' : ' is-no'}`}>{review.recommend ? 'Рекомендует' : 'Не рекомендует'}</span>
          )}
        </span>
        <span className="review-date">
          {dateLabel(review.at)}
          {review.edited ? ' · изменён' : ''}
        </span>
      </div>
      {review.criteria ? (
        <div className="review-criteria">
          {CRITERIA.map((c) => (
            <span key={c.key} className="review-criterion">
              <span>{c.label}</span>
              <Stars value={review.criteria![c.key]} size="s" />
            </span>
          ))}
        </div>
      ) : (
        <Stars value={review.rating} size="s" />
      )}
      {review.discipline && <div className="review-discipline">{review.discipline}</div>}
      <p className={`review-text${long && !full ? ' is-clamped' : ''}`}>{review.text}</p>
      {long && !full && (
        <button type="button" className="link-btn review-more" onClick={() => setFull(true)}>
          ещё
        </button>
      )}
      {review.author && (
        <div className="review-admin">
          {review.author.username ? `@${review.author.username}` : (review.author.name ?? `id ${review.author.id}`)} · id {review.author.id}
          {review.grp ? ` · ${review.grp}` : ''}
          {review.reports ? ` · жалоб: ${review.reports}` : ''}
          {review.hidden ? ' · скрыт' : ''}
        </div>
      )}
      {(onVote || onReport) && (
        <div className="review-foot">
          {onVote && (
            <>
              <button type="button" className="vote-btn" aria-pressed={review.helpful.mine === 1} aria-label="Полезно" onClick={() => onVote(1)}>
                👍 {review.helpful.up || ''}
              </button>
              <button type="button" className="vote-btn" aria-pressed={review.helpful.mine === -1} aria-label="Не полезно" onClick={() => onVote(-1)}>
                👎 {review.helpful.down || ''}
              </button>
            </>
          )}
          {onReport && (
            <button type="button" className="link-btn review-report" onClick={onReport}>
              Пожаловаться
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- форма отзыва ----------

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="star-row">
      <span className="star-row-label">{label}</span>
      <div className="star-picker" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${label}: ${n} из 5`}
            className={`star-btn${n <= value ? ' is-on' : ''}`}
            onClick={() => (haptic(), onChange(n))}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}

function ReviewForm({ teacher, card, onSaved }: { teacher: TeacherInfo; card: TeacherCard; onSaved: (card: TeacherCard) => void }) {
  const old = card.mine
  const [draft, setDraft] = useState<ReviewDraft>({
    clarity: old?.criteria?.clarity ?? 0,
    competence: old?.criteria?.competence ?? 0,
    communication: old?.criteria?.communication ?? 0,
    recommend: old?.recommend ?? null,
    text: old?.text ?? '',
    discipline: old?.discipline ?? null,
    confirm: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { text_min: min, text_max: max } = card.limits
  const length = [...draft.text.trim()].length
  const allRated = draft.clarity > 0 && draft.competence > 0 && draft.communication > 0
  const overall = allRated ? (draft.clarity + draft.competence + draft.communication) / 3 : null
  const ready = allRated && draft.recommend !== null && length >= min && length <= max && draft.confirm
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
      <Section title={old ? 'Изменить отзыв' : 'Оставить отзыв'}>
        <div className="form">
          {CRITERIA.map((c) => (
            <StarPicker key={c.key} label={c.label} value={draft[c.key]} onChange={(v) => set({ [c.key]: v } as Partial<ReviewDraft>)} />
          ))}
          <p className="form-hint">
            {overall !== null ? `Общая оценка — ${formatAverage(overall)} ★ (среднее трёх)` : 'Общая оценка — среднее трёх критериев'}
          </p>

          <div className="row-chips rec-choice" role="radiogroup" aria-label="Рекомендуешь?">
            <button type="button" className="chip" role="radio" aria-pressed={draft.recommend === true} onClick={() => (haptic(), set({ recommend: true }))}>
              👍 Рекомендую
            </button>
            <button type="button" className="chip" role="radio" aria-pressed={draft.recommend === false} onClick={() => (haptic(), set({ recommend: false }))}>
              👎 Не рекомендую
            </button>
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
          <p className="form-hint">{length < min ? `Ещё хотя бы ${min - length} симв.` : `${length} / ${max}`}</p>

          <label className="check-row">
            <input type="checkbox" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
            <span>Отзыв основан на моём опыте</span>
          </label>

          {error && <p className="form-error">{error}</p>}
          <button type="button" className="button-primary" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Отправляю…' : old ? 'Сохранить' : 'Отправить'}
          </button>
        </div>
      </Section>
    </>
  )
}
