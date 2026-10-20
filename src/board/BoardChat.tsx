import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CloseIcon, ReplyIcon, SendIcon } from '../icons'
import { confirmAction, haptic } from '../telegram'
import { boardApi, errorText, isRemoved, type BoardConfig, type BoardId, type Message, type Reaction } from './api'
import { markSeen } from './seen'
import { usePolling } from './usePolling'
import { BanNotice, useNotice } from './common'

type Props = {
  board: BoardId
  config: BoardConfig
  admin: boolean
  bannedUntil: number | null
  onBanned: (until: number | null) => void
}

const DAY_MS = 86_400_000

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160

function dayLabel(at: number): string {
  const date = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Сегодня'
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const timeLabel = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const authorLabel = (author: NonNullable<Message['author']>) =>
  author.username ? `@${author.username}` : (author.name ?? `id ${author.id}`)

// реакция вкл/выкл — сразу на экране, не дожидаясь бота
function toggled(reactions: Reaction[], emoji: string, on: boolean, order: string[]): Reaction[] {
  const list = reactions
    .map((r) => (r.emoji === emoji ? { ...r, count: r.count + (on ? 1 : -1), me: on } : r))
    .filter((r) => r.count > 0)
  if (on && !reactions.some((r) => r.emoji === emoji)) list.push({ emoji, count: 1, me: true })
  return list.sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji))
}

export function BoardChat({ board, config, admin, bannedUntil, onBanned }: Props) {
  const [messages, setMessages] = useState<Map<number, Message> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, flash] = useNotice()
  const cursor = useRef(0)
  const stickToBottom = useRef(false) // после отрисовки прокрутить вниз
  const keepFromBottom = useRef<number | null>(null) // подгрузили старые — не сдвигать экран
  const input = useRef<HTMLTextAreaElement>(null)
  const banned = Boolean(bannedUntil && bannedUntil > Date.now())

  useEffect(() => {
    let cancelled = false
    boardApi
      .chat(board, 0)
      .then((page) => {
        if (cancelled) return
        cursor.current = page.cursor
        stickToBottom.current = true
        setMessages(new Map(page.messages.filter((m) => !isRemoved(m)).map((m) => [m.id, m as Message])))
        setHasMore(page.has_more)
        onBanned(page.banned_until)
      })
      .catch((err) => !cancelled && setLoadError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [board, onBanned])

  // всё, что на экране, — прочитано (для точки «есть новое»)
  useEffect(() => {
    if (!messages?.size) return
    markSeen({ [board]: Math.max(...[...messages.values()].map((m) => m.at)) })
  }, [messages, board])

  usePolling(async () => {
    const page = await boardApi.chat(board, cursor.current)
    cursor.current = page.cursor
    onBanned(page.banned_until)
    if (!page.messages.length) return
    stickToBottom.current = nearBottom()
    setMessages((prev) => {
      const next = new Map(prev)
      const oldest = prev?.size ? Math.min(...prev.keys()) : 0
      for (const item of page.messages) {
        if (isRemoved(item)) next.delete(item.id)
        else if (item.id >= oldest) next.set(item.id, item) // изменения старше загруженного не нужны
      }
      return next
    })
  }, messages !== null)

  useLayoutEffect(() => {
    const root = document.documentElement
    if (keepFromBottom.current !== null) {
      window.scrollTo(0, root.scrollHeight - keepFromBottom.current)
      keepFromBottom.current = null
    } else if (stickToBottom.current) {
      window.scrollTo(0, root.scrollHeight)
      stickToBottom.current = false
    }
  }, [messages])

  // поле ввода растёт вместе с текстом (до 5 строк)
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  // пока пишешь, нижние вкладки прячем — клавиатура и так занимает пол-экрана
  useEffect(
    () => () => {
      delete document.documentElement.dataset.composing
    },
    [],
  )

  const update = (id: number, patch: (m: Message) => Message) =>
    setMessages((prev) => {
      const current = prev?.get(id)
      return current ? new Map(prev).set(id, patch(current)) : prev
    })

  const loadOlder = async () => {
    if (!messages?.size) return
    try {
      const page = await boardApi.chat(board, 0, Math.min(...messages.keys()))
      keepFromBottom.current = document.documentElement.scrollHeight - window.scrollY
      setMessages((prev) => {
        const next = new Map(prev)
        for (const m of page.messages) if (!isRemoved(m)) next.set(m.id, m)
        return next
      })
      setHasMore(page.has_more)
    } catch (err) {
      flash(errorText(err))
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    if ([...body].length > config.message_length) return flash(`Не больше ${config.message_length} символов`)
    setSending(true)
    try {
      const { message } = await boardApi.send(board, body, replyTo?.id ?? null)
      setText('')
      setReplyTo(null)
      stickToBottom.current = true
      setMessages((prev) => new Map(prev).set(message.id, message))
      haptic('light')
    } catch (err) {
      flash(errorText(err))
    } finally {
      setSending(false)
    }
  }

  const react = async (m: Message, emoji: string) => {
    const on = !m.reactions.find((r) => r.emoji === emoji)?.me
    const before = m.reactions
    update(m.id, (cur) => ({ ...cur, reactions: toggled(cur.reactions, emoji, on, config.reactions) }))
    haptic()
    try {
      const res = await boardApi.react(m.id, emoji, on)
      update(m.id, (cur) => ({ ...cur, reactions: res.reactions }))
    } catch (err) {
      update(m.id, (cur) => ({ ...cur, reactions: before }))
      flash(errorText(err))
    }
  }

  const report = async (m: Message) => {
    setSelected(null)
    if (!(await confirmAction('Пожаловаться на сообщение? Админ посмотрит его.'))) return
    try {
      await boardApi.report(m.id)
      flash('Жалоба отправлена. Спасибо!')
    } catch (err) {
      flash(errorText(err))
    }
  }

  const remove = async (m: Message) => {
    setSelected(null)
    if (!(await confirmAction('Удалить сообщение для всех?'))) return
    try {
      await boardApi.remove(m.id)
      setMessages((prev) => {
        const next = new Map(prev)
        next.delete(m.id)
        return next
      })
    } catch (err) {
      flash(errorText(err))
    }
  }

  const reply = (m: Message) => {
    setSelected(null)
    setReplyTo(m)
    input.current?.focus()
  }

  const jumpTo = (id: number | null) => {
    const el = id ? document.getElementById(`msg-${id}`) : null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (loadError) return <p className="board-empty">{loadError}</p>
  if (!messages) return <p className="board-empty">Загружаю…</p>

  const cutoff = Date.now() - config.keep_days * DAY_MS
  const list = [...messages.values()].filter((m) => m.at > cutoff).sort((a, b) => a.id - b.id)
  const length = [...text].length
  let lastDay = ''

  return (
    <>
      <div className="chat">
        {hasMore && (
          <button type="button" className="chat-more" onClick={loadOlder}>
            Показать раньше
          </button>
        )}
        {list.length === 0 && <p className="board-empty">Пока пусто. Напиши первым — для других ты аноним.</p>}
        {list.map((m) => {
          const day = dayLabel(m.at)
          const separator = day !== lastDay ? <div className="chat-day">{day}</div> : null
          lastDay = day
          return (
            <Fragment key={m.id}>
              {separator}
              <div id={`msg-${m.id}`} className={`msg${m.mine ? ' msg-mine' : ''}${m.hidden ? ' msg-hidden' : ''}`}>
                {!m.mine && (
                  <div className="msg-alias">
                    {m.alias}
                    {m.origin && <span className="msg-origin"> · {m.origin}</span>}
                    {m.author && <span className="msg-author"> · {authorLabel(m.author)}</span>}
                  </div>
                )}
                <div
                  className="msg-bubble"
                  role="button"
                  tabIndex={0}
                  aria-expanded={selected === m.id}
                  onClick={() => setSelected(selected === m.id ? null : m.id)}
                >
                  {m.reply && (
                    <span
                      className="msg-quote"
                      onClick={(e) => {
                        e.stopPropagation()
                        jumpTo(m.reply_to)
                      }}
                    >
                      <span className="msg-quote-alias">{m.reply.alias ?? 'Сообщение'}</span>
                      <span className="msg-quote-text">{m.reply.text ?? 'Удалено'}</span>
                    </span>
                  )}
                  <span className="msg-text">{m.text}</span>
                  <span className="msg-time">{timeLabel(m.at)}</span>
                </div>
                {admin && (m.hidden || Boolean(m.reports)) && (
                  <div className="msg-flag">{m.hidden ? `Скрыто до решения · жалоб: ${m.reports}` : `Жалоб: ${m.reports}`}</div>
                )}
                {m.reactions.length > 0 && (
                  <div className="msg-reactions">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className="reaction"
                        aria-pressed={r.me}
                        disabled={banned}
                        onClick={() => react(m, r.emoji)}
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}
                {selected === m.id && (
                  <div className="msg-actions">
                    {!banned &&
                      config.reactions.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="msg-react"
                          onClick={() => {
                            setSelected(null)
                            void react(m, emoji)
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    {!banned && (
                      <button type="button" className="msg-action" onClick={() => reply(m)}>
                        Ответить
                      </button>
                    )}
                    {!m.mine && !banned && (
                      <button type="button" className="msg-action" onClick={() => report(m)}>
                        Пожаловаться
                      </button>
                    )}
                    {admin && (
                      <button type="button" className="msg-action msg-action-danger" onClick={() => remove(m)}>
                        Удалить
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>

      <div className="composer">
        {notice && <p className="board-notice">{notice}</p>}
        {banned ? (
          <BanNotice until={bannedUntil!} />
        ) : (
          <>
            {replyTo && (
              <div className="composer-reply">
                <ReplyIcon />
                <span className="composer-reply-text">
                  <b>{replyTo.alias}</b> {replyTo.text}
                </span>
                <button type="button" className="composer-reply-close" onClick={() => setReplyTo(null)} aria-label="Не отвечать">
                  <CloseIcon />
                </button>
              </div>
            )}
            <div className="composer-row">
              <textarea
                ref={input}
                className="composer-input"
                rows={1}
                value={text}
                placeholder="Сообщение"
                onChange={(e) => setText(e.target.value)}
                onFocus={() => (document.documentElement.dataset.composing = '')}
                onBlur={() => delete document.documentElement.dataset.composing}
                onKeyDown={(e) => {
                  // на компьютере Enter отправляет, Shift+Enter — новая строка; на телефоне Enter — новая строка
                  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              {length > config.message_length - 50 && (
                <span className={`composer-count${length > config.message_length ? ' is-over' : ''}`}>
                  {config.message_length - length}
                </span>
              )}
              <button
                type="button"
                className="composer-send"
                disabled={!text.trim() || sending}
                onPointerDown={(e) => e.preventDefault()} // не убирать клавиатуру при нажатии
                onClick={send}
                aria-label="Отправить"
              >
                <SendIcon />
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
