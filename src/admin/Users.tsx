import { useCallback, useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { ChevronLeft } from '../icons'
import { confirmAction, haptic, openTelegramLink } from '../telegram'
import { useBackButton } from '../useBackButton'
import { loadGroups, useGroupNames } from '../data'
import type { GroupInfo } from '../../shared/groups'
import { GroupSearch } from '../onboarding/GroupSearch'
import { adminApi, adminError, stamp, userName, type AdminUser, type UserCard } from './api'
import { Loading, useFlash, useLoad } from './common'

// бан «навсегда» бот хранит как 9999 год
const isForever = (until: number) => until - Date.now() > 5 * 365 * 86_400_000

function flags(u: AdminUser) {
  const now = Date.now()
  return [
    u.banned ? '🚫' : '',
    u.board_banned_until && u.board_banned_until > now ? '🔇' : '',
    u.review_banned_until && u.review_banned_until > now ? '⭐' : '',
    u.blocked_bot ? '⛔' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function Users() {
  const { data, reload } = useLoad(adminApi.users)
  const groupName = useGroupNames()
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const close = useCallback(() => {
    setOpenId(null)
    reload()
  }, [reload])
  useBackButton(openId !== null ? close : null)

  if (openId !== null) return <UserCardView id={openId} onClose={close} />
  if (!data) return <Loading />

  const q = query.trim().toLowerCase().replace(/^@/, '')
  const list = q
    ? data.users.filter(
        (u) => String(u.id).includes(q) || u.username?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q),
      )
    : data.users

  return (
    <div className="page-body">
      <input
        className="input"
        type="search"
        placeholder="Имя, @ник или id"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="utable">
        <div className="urow uhead">
          <span className="uname">Кто</span>
          <span>Гр.</span>
          <span>Виз.</span>
          <span>Был</span>
        </div>
        {list.map((u) => (
          <button
            key={u.id}
            type="button"
            className="urow"
            onClick={() => {
              haptic()
              setOpenId(u.id)
              window.scrollTo(0, 0)
            }}
          >
            <span className="uname">
              {u.name || userName(u)}
              <small>
                {u.username ? `@${u.username}` : `id ${u.id}`} {flags(u)}
              </small>
            </span>
            <span>{u.role === 'teacher' ? 'преп.' : groupName(u.grp)}</span>
            <span>{u.visits}</span>
            <span>{stamp(u.last_seen).slice(0, 5)}</span>
          </button>
        ))}
      </div>
      <p className="section-footer">
        Показано {list.length} из {data.users.length}. 🚫 бан · 🔇 бан в чате · ⭐ бан в отзывах · ⛔ заблокировал бота
      </p>
    </div>
  )
}

function UserCardView({ id, onClose }: { id: number; onClose: () => void }) {
  const groupName = useGroupNames()
  const [card, setCard] = useState<UserCard | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()

  useEffect(() => {
    adminApi.user(id).then(setCard, (err) => flash(adminError(err)))
  }, [id, flash])

  const run = async (action: () => Promise<UserCard>, done: string) => {
    setBusy(true)
    try {
      setCard(await action())
      haptic('light')
      flash(done)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button type="button" className="page-back admin-sub-back" onClick={onClose}>
      <ChevronLeft /> Все пользователи
    </button>
  )
  if (!card) return <div className="page-body">{back}{notice ?? <Loading />}</div>

  const u = card.user
  const now = Date.now()
  const boardBanned = u.board_banned_until && u.board_banned_until > now ? u.board_banned_until : null
  const reviewBanned = u.review_banned_until && u.review_banned_until > now ? u.review_banned_until : null

  const deleteMessage = async (messageId: number) => {
    if (!(await confirmAction('Удалить сообщение из чата?'))) return
    try {
      await adminApi.moderate(messageId, 'del')
      setCard(await adminApi.user(id))
      flash('Удалено')
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="page-body">
      {back}
      <div className="admin-card">
        <div className="admin-card-title">{u.name || userName(u)}</div>
        <div className="admin-card-sub">
          {u.username ? (
            <button type="button" className="link-btn" onClick={() => openTelegramLink(`https://t.me/${u.username}`)}>
              @{u.username}
            </button>
          ) : (
            'без ника'
          )}{' '}
          · id {u.id}
          {u.owner && ' · это вы'}
        </div>
      </div>

      <Section>
        <div className="row">
          <span>Кто</span>
          <span className="row-value">
            {u.role === 'teacher' ? `преподаватель (${u.teacher_id})` : u.role === 'student' ? 'студент' : 'не выбирал'}
          </span>
        </div>
        <div className="row">
          <span>Группа в профиле</span>
          <span className="row-value">{u.grp ? groupName(u.grp) : 'не выбрана'}</span>
        </div>
        <div className="row">
          <span>Первый визит</span>
          <span className="row-value">{stamp(u.first_seen)}</span>
        </div>
        <div className="row">
          <span>Последний</span>
          <span className="row-value">{stamp(u.last_seen)}</span>
        </div>
        <div className="row">
          <span>Открытий · /start</span>
          <span className="row-value">
            {u.visits} · {u.starts}
          </span>
        </div>
        <div className="row">
          <span>Бот может писать</span>
          <span className="row-value">{u.blocked_bot ? 'заблокировал бота' : u.can_message ? 'да' : 'нет — не писал боту'}</span>
        </div>
        <div className="row">
          <span>Календарь</span>
          <span className="row-value">
            {card.calendar ? `${groupName(card.calendar.grp)} · обновлялся ${stamp(card.calendar.last_fetch_at)}` : 'не подключён'}
          </span>
        </div>
      </Section>

      <StarostaRow
        value={u.starosta_of}
        groupName={groupName}
        busy={busy}
        onSet={(group) => run(() => adminApi.starosta(id, group), group ? 'Назначен старостой' : 'Больше не староста')}
      />

      <Section
        title="Доступ"
        footer="На будущее: сейчас всё бесплатно для всех, доступ ни на что не влияет. free_forever — навсегда бесплатно (МБ(МП) 1-1/1-2 и все, кто был до онбординга)."
      >
        <div className="row">
          <span>Сейчас</span>
          <span className="row-value">{u.access === 'free_forever' ? 'free_forever' : 'standard'}</span>
        </div>
        <button
          type="button"
          className="row row-btn row-link"
          disabled={busy}
          onClick={() =>
            u.access === 'free_forever'
              ? run(() => adminApi.access(id, 'standard'), 'Доступ: standard')
              : run(() => adminApi.access(id, 'free_forever'), 'Выдан free_forever')
          }
        >
          {u.access === 'free_forever' ? 'Забрать free_forever' : 'Выдать free_forever'}
        </button>
      </Section>

      {!u.owner && (
        <Section title="Бан в боте и приложении">
          {u.banned ? (
            <>
              <div className="row row-text">Забанен{u.ban_reason ? `: ${u.ban_reason}` : ''}</div>
              <button type="button" className="row row-btn row-link" disabled={busy} onClick={() => run(() => adminApi.unban(id), 'Разбанен')}>
                Разбанить
              </button>
            </>
          ) : (
            <div className="row row-form">
              <input className="input" placeholder="Причина (необязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button
                type="button"
                className="button-inline danger"
                disabled={busy}
                onClick={async () => {
                  if (await confirmAction(`Забанить ${userName(u)}? Бот и приложение будут для него закрыты.`)) {
                    await run(() => adminApi.ban(id, reason), 'Забанен')
                  }
                }}
              >
                Забанить
              </button>
            </div>
          )}
        </Section>
      )}

      {!u.owner && (
        <Section title="Чат" footer="Забаненный может читать, но не писать.">
          <div className="row">
            <span>Бан в чате</span>
            <span className="row-value">{boardBanned ? (isForever(boardBanned) ? 'навсегда' : `до ${stamp(boardBanned)}`) : 'нет'}</span>
          </div>
          <div className="row row-chips">
            {[
              { label: '1 день', days: 1 },
              { label: '7 дней', days: 7 },
              { label: 'Навсегда', days: null },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => run(() => adminApi.boardBan(id, o.days), 'Бан в чате выдан')}
              >
                {o.label}
              </button>
            ))}
            {boardBanned && (
              <button type="button" className="chip chip-accent" disabled={busy} onClick={() => run(() => adminApi.boardBan(id, 0), 'Бан в чате снят')}>
                Снять
              </button>
            )}
          </div>
        </Section>
      )}

      {!u.owner && (
        <Section
          title={`Отзывы о преподавателях (${card.reviews.filter((r) => !r.deleted).length})`}
          footer="Забаненный в отзывах может читать, но не писать и не жаловаться. Удалять отзывы — «Админ-панель → Отзывы»."
        >
          <div className="row">
            <span>Бан в отзывах</span>
            <span className="row-value">{reviewBanned ? (isForever(reviewBanned) ? 'навсегда' : `до ${stamp(reviewBanned)}`) : 'нет'}</span>
          </div>
          <div className="row row-chips">
            {[
              { label: '7 дней', days: 7 },
              { label: '30 дней', days: 30 },
              { label: 'Навсегда', days: null },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => run(() => adminApi.reviewBan(id, o.days), 'Бан в отзывах выдан')}
              >
                {o.label}
              </button>
            ))}
            {reviewBanned && (
              <button type="button" className="chip chip-accent" disabled={busy} onClick={() => run(() => adminApi.reviewBan(id, 0), 'Бан в отзывах снят')}>
                Снять
              </button>
            )}
          </div>
          {card.reviews.map((r) => (
            <div key={r.id} className="row admin-msg">
              <div className="admin-msg-body">
                <div className="admin-msg-meta">
                  {'★'.repeat(r.rating)} · {r.teacher_id} · {stamp(r.created_at)}
                  {r.deleted ? ' · удалён' : r.hidden ? ' · скрыт' : ''}
                </div>
                <div className={`admin-msg-text${r.deleted ? ' is-deleted' : ''}`}>{r.text}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      {notice}

      <Section title={`Сообщения в чате (${card.messages.length})`}>
        {card.messages.length === 0 && <div className="row row-text">Не писал</div>}
        {card.messages.map((m) => (
          <div key={m.id} className="row admin-msg">
            <div className="admin-msg-body">
              <div className="admin-msg-meta">
                {m.alias}{m.origin ? ` · ${m.origin}` : ''} · {stamp(m.created_at)}
                {m.deleted ? ' · удалено' : m.hidden ? ' · скрыто' : ''}
              </div>
              <div className={`admin-msg-text${m.deleted ? ' is-deleted' : ''}`}>{m.text}</div>
            </div>
            {!m.deleted && (
              <button type="button" className="link-btn danger" onClick={() => deleteMessage(m.id)}>
                Удалить
              </button>
            )}
          </div>
        ))}
      </Section>

      <Section title={`Визиты (последние ${card.visits.length} из ${card.visit_log_total})`}>
        {card.visits.map((v) => (
          <div key={v.ts} className="row">
            <span>{stamp(v.ts)}</span>
            <span className="row-value">{v.kind === 'start' ? '/start' : 'открыл приложение'}</span>
          </div>
        ))}
      </Section>
    </div>
  )
}

// Староста группы: может править расписание только этой группы («Ещё → Правки группы»)
function StarostaRow({
  value,
  groupName,
  busy,
  onSet,
}: {
  value: string | null
  groupName: (id: string | null) => string
  busy: boolean
  onSet: (group: string | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  useEffect(() => {
    if (picking && !groups) loadGroups().then((i) => setGroups(i.groups), () => {})
  }, [picking, groups])
  return (
    <Section title="Староста" footer="Староста видит «Ещё → Правки группы» и правит только свою группу. Все правки — у вас в «Расписании» с автором.">
      <div className="row">
        <span>Группа</span>
        <span className="row-value">{value ? groupName(value) : 'не староста'}</span>
      </div>
      {value && (
        <button type="button" className="row row-btn row-link" disabled={busy} onClick={() => onSet(null)}>
          Снять со старост
        </button>
      )}
      {picking ? (
        groups ? (
          <div className="row row-plain">
            <GroupSearch
              groups={groups}
              onPick={(g) => {
                setPicking(false)
                onSet(g.id)
              }}
            />
          </div>
        ) : (
          <div className="row row-text">Загружаю группы…</div>
        )
      ) : (
        <button type="button" className="row row-btn row-link" disabled={busy} onClick={() => setPicking(true)}>
          {value ? 'Сделать старостой другой группы' : 'Назначить старостой группы…'}
        </button>
      )}
    </Section>
  )
}
