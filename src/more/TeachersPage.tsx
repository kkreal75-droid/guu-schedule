import { useCallback, useEffect, useMemo, useState } from 'react'
import { teacherKey } from '../../shared/schedule-core'
import { botAvailable } from '../api'
import { useNotice } from '../notice'
import { BottomAction } from '../components/BottomAction'
import { Row } from '../components/Row'
import { SearchField } from '../components/SearchField'
import { Section } from '../components/Section'
import { Sheet } from '../components/Sheet'
import { loadTeachers, searchTeachers, type TeacherInfo } from '../data'
import { useFavorites } from '../favorites'
import { CheckIcon, ChevronDownSmall, Icon } from '../icons'
import {
  formatAverage, reviewError, reviewsApi, reviewsWord, type Criteria, type Rated, type Review, type ReviewDraft, type TeacherCard,
} from '../reviews/api'
import { confirmAction, haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { ScheduleViewer } from './ScheduleViewer'
import { getLang, t, tKnown, tn } from '../i18n'
import { LOCALE } from '../../shared/i18n-core'
import { splitDegree, trSubject, trTeacher } from '../guu'
import { TeacherLoad } from './TeacherLoad'

// «Сервисы → Рейтинг преподавателей» (этапы 6 и 7.6): список одним блоком (поиск, сортировка и фильтр — в окне по
// ссылке справа), карточка (учёная степень строкой, действия списком, «Оставить отзыв», нагрузка, оценки
// по критериям, отзывы «Полезные / Новые»), отзыв — три критерия цифрами 1–5 + «Советую / Не советую». Авторы
// анонимны. Отзыв оставляют только студенты, у чьей группы преподаватель ведёт (или вёл в прошлом семестре) пары —
// это проверяет бот.

type Sort = 'rating' | 'count' | 'name'
const sortLabel = (sort: Sort) => ({ rating: t('По оценке'), count: t('По отзывам'), name: t('По алфавиту') })[sort]
const sorts: Sort[] = ['rating', 'count', 'name']
type Filter = 'all' | 'rated' | 'mine'
const filters = (): { value: Filter; label: string }[] => [
  { value: 'all', label: t('Все') },
  { value: 'rated', label: t('С оценкой') },
  { value: 'mine', label: t('Преподаватели твоей группы') },
]

const criteria = (): { key: keyof Criteria; label: string }[] => [
  { key: 'clarity', label: t('Понятно объясняет') },
  { key: 'competence', label: t('Знает предмет') },
  { key: 'communication', label: t('Легко общаться') },
]
const PAGE = 50
const REVIEWS_PAGE = 5

// учёная степень и должность — из названий предметов в файлах ГУУ («… к.э.н., доцент»)
const degreeOf = (teacher: TeacherInfo) => teacher.subjects.map((s) => splitDegree(s)[1]).find(Boolean) ?? null

// «★ 4,6 · 12 отзывов · 80% советуют»
function ratedText(avg: number | null, n: number, rec: number | null) {
  return [avg != null ? `★ ${formatAverage(avg)}` : null, `${n} ${reviewsWord(n)}`, rec != null ? t('{pct}% советуют', { pct: rec }) : null]
    .filter(Boolean)
    .join(' · ')
}

type TeacherWithPast = TeacherInfo & { past_groups?: string[] }

// initial — сразу открыть карточку (нажали преподавателя в паре); onClose — «Назад» из неё (на расписание);
// group — своя группа (фильтр «Преподаватели твоей группы»)
export function TeachersPage({ initial, onClose, group }: { initial?: TeacherInfo; onClose?: () => void; group?: string } = {}) {
  const [list, setList] = useState<TeacherWithPast[] | null>(null)
  const [rated, setRated] = useState<Map<string, Rated>>(new Map())
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('rating')
  const [filter, setFilter] = useState<Filter>('all')
  const [options, setOptions] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<TeacherInfo | null>(initial ?? null)
  const closeOptions = useCallback(() => setOptions(false), [])

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

  if (open) return <TeacherView teacher={open} />
  if (error) {
    return (
      <>
        <h1 className="page-title page-title-gap">{t('Рейтинг преподавателей')}</h1>
        <p className="lead">{t('Не получилось загрузить список преподавателей.')}</p>
        <button type="button" className="link-btn" onClick={load}>
          {t('Повторить')}
        </button>
      </>
    )
  }

  return (
    <div className="rating-page">
      <h1 className="page-title page-title-gap">{t('Рейтинг преподавателей')}</h1>
      <SearchField
        value={query}
        onChange={(v) => (setQuery(v), setLimit(PAGE))}
        placeholder={t('Фамилия преподавателя')}
        label={t('Фамилия преподавателя')}
      />
      <div className="rating-meta">
        <span>
          {list ? shown.length : '…'} {tn(list ? shown.length : 0, 'преподаватель|преподавателя|преподавателей')}
          {filter !== 'all' && ` · ${filters().find((f) => f.value === filter)!.label.toLowerCase()}`}
        </span>
        <button type="button" className="link-btn" onClick={() => (haptic(), setOptions(true))}>
          {sortLabel(sort)}
          <ChevronDownSmall />
        </button>
      </div>

      {!list && <p className="gsearch-empty">{t('Загружаю…')}</p>}
      {list && !shown.length && (
        <p className="gsearch-empty">{query.trim().length >= 2 ? t('Не нашёл такую фамилию в расписании ГУУ.') : t('Никого нет.')}</p>
      )}
      {shown.length > 0 && (
        <div className="list">
          {shown.slice(0, limit).map((teacher) => {
            const r = rated.get(teacher.id)
            return (
              <Row
                key={teacher.id}
                title={trTeacher(teacher.name)}
                sub={<span className="gsearch-sub">{r ? ratedText(r.avg, r.n, r.rec) : teacher.subjects[0] && trSubject(teacher.subjects[0])}</span>}
                chevron
                onClick={() => (haptic(), setOpen(teacher), window.scrollTo(0, 0))}
              />
            )
          })}
        </div>
      )}
      {shown.length > limit && (
        <button type="button" className="button-secondary" onClick={() => setLimit((l) => l + PAGE)}>
          {t('Показать ещё')}
        </button>
      )}

      {options && (
        <Sheet label={t('Сортировка')} onClose={closeOptions}>
          <h2 className="sheet-title">{t('Сортировка')}</h2>
          <div className="list">
            {sorts.map((s) => (
              <Row key={s} title={sortLabel(s)} check={sort === s} onClick={() => (haptic(), setSort(s), setLimit(PAGE))} />
            ))}
          </div>
          <h3 className="section-title sheet-caption">{t('Показывать')}</h3>
          <div className="list">
            {filters()
              .filter((f) => f.value !== 'mine' || group)
              .map((f) => (
                <Row key={f.value} title={f.label} check={filter === f.value} onClick={() => (haptic(), setFilter(f.value), setLimit(PAGE))} />
              ))}
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ---------- карточка преподавателя ----------

function TeacherView({ teacher }: { teacher: TeacherInfo }) {
  const [card, setCard] = useState<TeacherCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'card' | 'form' | 'schedule'>('card')
  const [order, setOrder] = useState<'useful' | 'new'>('useful')
  const [limit, setLimit] = useState(REVIEWS_PAGE)
  const [notice, flash] = useNotice()
  const favorites = useFavorites()
  const key = teacherKey(teacher.id)

  useEffect(() => {
    if (!botAvailable()) return
    reviewsApi.teacher(teacher.id).then(setCard, (err) => setError(reviewError(err)))
  }, [teacher.id])

  const toCard = useCallback(() => {
    setMode('card')
    window.scrollTo(0, 0)
  }, [])
  useBackButton(mode !== 'card' ? toCard : null)

  if (mode === 'schedule') {
    return (
      <ScheduleViewer
        id={key}
        actions={
          <div className="viewer-head">
            <h1 className="page-title">{trTeacher(teacher.name)}</h1>
            <p className="viewer-sub">{t('По файлам ГУУ, у пар указаны группы')}</p>
          </div>
        }
      />
    )
  }

  if (mode === 'form' && card) {
    return (
      <ReviewForm
        teacher={teacher}
        card={card}
        onSaved={(next) => {
          setCard(next)
          toCard()
          flash(t('Отзыв сохранён. Спасибо!'))
          haptic('light')
        }}
      />
    )
  }

  const remove = async () => {
    if (!(await confirmAction(t('Удалить свой отзыв?')))) return
    try {
      setCard(await reviewsApi.remove(teacher.id))
      flash(t('Отзыв удалён'))
    } catch (err) {
      flash(reviewError(err))
    }
  }

  const report = async (review: Review) => {
    if (!(await confirmAction(t('Пожаловаться на отзыв? Его проверят.')))) return
    try {
      await reviewsApi.report(review.id)
      flash(t('Жалоба отправлена. Спасибо!'))
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
  const degree = degreeOf(teacher)
  const isHome = favorites?.home === key
  const inFavorites = Boolean(favorites?.list.includes(key))

  return (
    <>
      <h1 className="page-title">{trTeacher(teacher.name)}</h1>
      {degree && <p className="teacher-degree">{degree}</p>}
      <p className="teacher-rating">
        {card && card.average != null ? ratedText(card.average, card.count, card.recommend) : card || !botAvailable() ? t('Отзывов пока мало') : ' '}
      </p>

      <div className="list teacher-actions">
        <Row icon="person" title={t('Расписание преподавателя')} chevron onClick={() => (haptic(), setMode('schedule'), window.scrollTo(0, 0))} />
        {favorites && !isHome && (
          <Row
            icon="star"
            title={inFavorites ? t('В избранном') : t('Добавить в избранное')}
            check={inFavorites}
            chevron={!inFavorites}
            onClick={() => {
              haptic('light')
              if (inFavorites) favorites.remove(key)
              else favorites.add(key)
            }}
          />
        )}
      </div>

      {notice && <p className="notice-toast">{notice}</p>}
      {!botAvailable() && <p className="lead teacher-note">{t('Отзывы работают в Telegram — откройте расписание там.')}</p>}
      {error && <p className="lead teacher-note">{error}</p>}
      {botAvailable() && !card && !error && <p className="lead teacher-note">{t('Загружаю отзывы…')}</p>}

      {card &&
        (card.mine ? null : banned ? (
          <p className="lead teacher-note">{t('Тебе запрещено писать отзывы.')}</p>
        ) : card.can_review ? (
          <button type="button" className="button-primary teacher-review-btn" onClick={goForm}>
            {t('Оставить отзыв')}
          </button>
        ) : (
          card.reason && <p className="section-footer teacher-note">{tKnown(card.reason) ?? card.reason}</p>
        ))}

      <TeacherLoad id={teacher.id} />

      {card && (
        <>
          {card.criteria && (
            <Section title={t('Оценки')} footer={card.count > 0 ? t('По {n} {reviews}', { n: card.count, reviews: reviewsWord(card.count) }) : undefined}>
              {criteria().map((c) => (
                <div key={c.key} className="row score-row">
                  <span className="score-label">{c.label}</span>
                  <span className="progress score-bar" aria-hidden="true">
                    <span style={{ width: `${((card.criteria![c.key] ?? 0) / 5) * 100}%` }} />
                  </span>
                  <span className="score-value">{formatAverage(card.criteria![c.key] ?? 0)}</span>
                </div>
              ))}
              <Distribution card={card} />
            </Section>
          )}

          {card.mine && (
            <Section title={t('Мой отзыв')} footer={card.mine.hidden ? t('Скрыт после жалоб — ждёт проверки.') : t('Видят все, но без имени и группы.')}>
              <ReviewItem review={card.mine} />
              <div className="row review-own-actions">
                {!banned && (
                  <button type="button" className="link-btn" onClick={goForm}>
                    {t('Изменить')}
                  </button>
                )}
                <button type="button" className="link-btn danger" onClick={remove}>
                  {t('Удалить')}
                </button>
              </div>
            </Section>
          )}

          <section className="section">
            <div className="reviews-head">
              <h3 className="section-title">
                {t('Отзывы')}
                {others.length ? ` · ${others.length}` : ''}
              </h3>
              {others.length > 1 && (
                <button type="button" className="link-btn reviews-order" onClick={() => (haptic(), setOrder(order === 'useful' ? 'new' : 'useful'))}>
                  {order === 'useful' ? t('Полезные') : t('Новые')}
                  <ChevronDownSmall />
                </button>
              )}
            </div>
            {others.length === 0 ? (
              <div className="list">
                <Row title={<span className="hidden-empty">{t('Пока никто не написал')}</span>} />
              </div>
            ) : (
              <div className="list">
                {others.slice(0, limit).map((r) => (
                  <ReviewItem
                    key={r.id}
                    review={r}
                    onReport={banned ? undefined : () => report(r)}
                    onVote={banned ? undefined : (v) => vote(r, v)}
                  />
                ))}
              </div>
            )}
            {others.length > limit && (
              <button type="button" className="button-secondary" onClick={() => setLimit((l) => l + 10)}>
                {t('Ещё {n}', { n: others.length - limit })}
              </button>
            )}
          </section>

          {card.contact && (
            <p className="section-footer review-contact">
              {t('Вы преподаватель и не согласны с отзывом? Напишите')}{' '}
              <button type="button" className="link-btn review-contact-link" onClick={() => openTelegramLink(`https://t.me/${card.contact!.slice(1)}`)}>
                {card.contact}
              </button>
            </p>
          )}
        </>
      )}
    </>
  )
}

// сколько оценок 5, 4, 3, 2, 1 — полосками цвета акцента
function Distribution({ card }: { card: TeacherCard }) {
  const max = Math.max(1, ...card.distribution)
  return (
    <>
      {[5, 4, 3, 2, 1].map((n) => (
        <div key={n} className="row score-row">
          <span className="score-label">{t('Оценка {n}', { n })}</span>
          <span className="progress score-bar" aria-hidden="true">
            <span style={{ width: `${(card.distribution[n - 1] / max) * 100}%` }} />
          </span>
          <span className="score-value">{card.distribution[n - 1]}</span>
        </div>
      ))}
    </>
  )
}

const dateLabel = (at: number) => new Date(at).toLocaleDateString(LOCALE[getLang()], { day: 'numeric', month: 'long', year: 'numeric' })

function ReviewItem({ review, onReport, onVote }: { review: Review; onReport?: () => void; onVote?: (value: number) => void }) {
  const [full, setFull] = useState(false)
  const long = review.text.length > 260
  return (
    <div className={`row review${review.hidden ? ' is-hidden' : ''}`}>
      <div className="review-head">
        <span className="review-who">
          {review.mine ? t('Ты') : t('Студент')}
          {review.recommend !== null && <span className="review-rec"> · {review.recommend ? t('советует') : t('не советует')}</span>}
        </span>
        <span className="review-date">
          {dateLabel(review.at)}
          {review.edited ? ` · ${t('изменён')}` : ''}
        </span>
      </div>
      <div className="review-scores">
        {review.criteria
          ? criteria()
              .map((c) => `${c.label} — ${review.criteria![c.key]}`)
              .join(' · ')
          : t('Оценка {n}', { n: review.rating })}
      </div>
      {review.discipline && <div className="review-discipline">{trSubject(review.discipline)}</div>}
      <p className={`review-text${long && !full ? ' is-clamped' : ''}`}>{review.text}</p>
      {long && !full && (
        <button type="button" className="link-btn review-more" onClick={() => setFull(true)}>
          {t('ещё#текст отзыва')}
        </button>
      )}
      {review.author && (
        <div className="review-admin">
          {review.author.username ? `@${review.author.username}` : (review.author.name ?? `id ${review.author.id}`)} · id {review.author.id}
          {review.grp ? ` · ${review.grp}` : ''}
          {review.reports ? ` · ${t('жалоб: {n}', { n: review.reports })}` : ''}
          {review.hidden ? ` · ${t('скрыт')}` : ''}
        </div>
      )}
      {(onVote || onReport) && (
        <div className="review-foot">
          {onVote && (
            <>
              <button type="button" className="vote-btn" aria-pressed={review.helpful.mine === 1} aria-label={t('Полезно')} onClick={() => onVote(1)}>
                <Icon name="thumb" size={17} />
                {review.helpful.up || ''}
              </button>
              <button type="button" className="vote-btn" aria-pressed={review.helpful.mine === -1} aria-label={t('Не полезно')} onClick={() => onVote(-1)}>
                <Icon name="thumb" size={17} className="icon-flip" />
                {review.helpful.down || ''}
              </button>
            </>
          )}
          {onReport && (
            <button type="button" className="link-btn review-report" onClick={onReport}>
              {t('Пожаловаться')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- форма отзыва ----------

// оценка цифрами 1–5: выбранная — цвета акцента
function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="row score-pick">
      <span className="score-pick-label">{label}</span>
      <span className="score-pick-buttons" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t('{label}: {n} из 5', { label, n })}
            className="score-btn"
            onClick={() => (haptic(), onChange(n))}
          >
            {n}
          </button>
        ))}
      </span>
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
    <div className="review-form page-fill">
      <p className="ob-overline">{old ? t('Изменить отзыв') : t('Отзыв анонимный')}</p>
      <h1 className="page-title review-form-name">{trTeacher(teacher.name)}</h1>
      <p className="page-lead">{t('Оценивай преподавание, а не человека. Без оскорблений и личных данных.')}</p>

      <div className="list">
        {criteria().map((c) => (
          <ScorePicker key={c.key} label={c.label} value={draft[c.key]} onChange={(v) => set({ [c.key]: v } as Partial<ReviewDraft>)} />
        ))}
      </div>

      <div className="segmented review-rec" role="radiogroup" aria-label={t('Советуешь?')}>
        <button type="button" role="radio" aria-checked={draft.recommend === true} className="segmented-item" onClick={() => (haptic(), set({ recommend: true }))}>
          {t('Советую')}
        </button>
        <button type="button" role="radio" aria-checked={draft.recommend === false} className="segmented-item" onClick={() => (haptic(), set({ recommend: false }))}>
          {t('Не советую')}
        </button>
      </div>

      {teacher.subjects.length > 0 && (
        <div className="list">
          <label className="row review-discipline-row">
            <span className="row-label">
              <span className="row-text">{t('Дисциплина')}</span>
            </span>
            <span className="row-value">{draft.discipline ? trSubject(draft.discipline) : t('не выбрана')}</span>
            <select
              className="row-select"
              value={draft.discipline ?? ''}
              aria-label={t('Дисциплина')}
              onChange={(e) => set({ discipline: e.target.value || null })}
            >
              <option value="">{t('не выбрана')}</option>
              {teacher.subjects.map((s) => (
                <option key={s} value={s}>
                  {trSubject(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <textarea
        className="input textarea review-textarea"
        rows={4}
        value={draft.text}
        maxLength={max + 50}
        placeholder={t('Как объясняет, как принимает работы, что понравилось')}
        aria-label={t('Отзыв')}
        onChange={(e) => set({ text: e.target.value })}
      />
      <p className="section-footer">
        {length < min ? tn(min - length, 'Ещё хотя бы {n} символ|Ещё хотя бы {n} символа|Ещё хотя бы {n} символов') : `${length} / ${max}`}
      </p>

      <label className="check-row">
        <input type="checkbox" className="check" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
        <span className="check-box" aria-hidden="true">
          <CheckIcon />
        </span>
        <span>{t('Отзыв основан на моём опыте')}</span>
      </label>

      {error && <p className="form-error">{error}</p>}
      <BottomAction>
        <button type="button" className="button-primary" disabled={!ready || busy} onClick={submit}>
          {busy ? t('Отправляю…') : old ? t('Сохранить') : t('Отправить')}
        </button>
      </BottomAction>
    </div>
  )
}
