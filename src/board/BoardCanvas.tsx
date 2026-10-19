import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EraserIcon, UndoIcon } from '../icons'
import { confirmAction, haptic } from '../telegram'
import { boardApi, errorText, isRemoved, type BoardConfig, type BoardId, type Stroke } from './api'
import { BanNotice, useNotice } from './common'
import { usePolling } from './usePolling'

type Props = {
  board: BoardId
  config: BoardConfig
  admin: boolean
  bannedUntil: number | null
  onBanned: (until: number | null) => void
}

// Холст — 1000×1000 условных единиц, штрихи векторные: на любом экране одинаково
const SIZE = 1000
const MIN_STEP = 3 // точки ближе этого не записываем
const COLOR_NAMES = ['Чёрный', 'Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Синий', 'Фиолетовый', 'Розовый']
const WIDTH_NAMES = ['Тонкая', 'Средняя', 'Толстая']

type Drawable = Pick<Stroke, 'c' | 'w' | 'p'>

function paint(ctx: CanvasRenderingContext2D, s: Drawable, scale: number) {
  const p = s.p
  ctx.strokeStyle = s.c
  ctx.fillStyle = s.c
  ctx.lineWidth = s.w * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (p.length === 2) {
    ctx.arc(p[0] * scale, p[1] * scale, (s.w * scale) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.moveTo(p[0] * scale, p[1] * scale)
  // сглаживание: кривые через середины отрезков
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i] * scale, p[i + 1] * scale, ((p[i] + p[i + 2]) / 2) * scale, ((p[i + 1] + p[i + 3]) / 2) * scale)
  }
  ctx.lineTo(p[p.length - 2] * scale, p[p.length - 1] * scale)
  ctx.stroke()
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function hits(s: Stroke, x: number, y: number) {
  const r = s.w / 2 + 12
  const p = s.p
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= r
  for (let i = 0; i < p.length - 2; i += 2) {
    if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true
  }
  return false
}

export function BoardCanvas({ board, config, admin, bannedUntil, onBanned }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef(new Map<number, Stroke>())
  const pending = useRef(new Map<number, Stroke>()) // ещё не сохранённые (id < 0)
  const erasing = useRef(new Set<number>())
  const current = useRef<number[] | null>(null)
  const pointer = useRef<number | null>(null)
  const cursor = useRef(0)
  const nextTempId = useRef(-1)
  const frame = useRef(0)
  const [loaded, setLoaded] = useState(false)
  const [color, setColor] = useState(config.colors[0])
  const [width, setWidth] = useState(config.widths[1])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [busy, setBusy] = useState(0)
  const [notice, flash] = useNotice()
  const style = useRef({ color, width })
  useLayoutEffect(() => {
    style.current = { color, width }
  })
  const banned = Boolean(bannedUntil && bannedUntil > Date.now())

  const draw = useCallback(() => {
    frame.current = 0
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const scale = el.width / SIZE
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, el.width, el.height)
    for (const s of strokes.current.values()) if (!erasing.current.has(s.id)) paint(ctx, s, scale)
    for (const s of pending.current.values()) paint(ctx, s, scale)
    if (current.current) paint(ctx, { c: style.current.color, w: style.current.width, p: current.current }, scale)
  }, [])
  const redraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw)
  }, [draw])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // размер в пикселях экрана — чтобы линии были чёткими
  useEffect(() => {
    const el = canvas.current!
    const resize = () => {
      const px = Math.round(el.clientWidth * (window.devicePixelRatio || 1))
      if (px && el.width !== px) {
        el.width = px
        el.height = px
        draw()
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [draw])

  const apply = useCallback(
    (items: (Stroke | { id: number; removed: true })[]) => {
      for (const item of items) {
        if (isRemoved(item)) strokes.current.delete(item.id)
        else strokes.current.set(item.id, item)
      }
      redraw()
    },
    [redraw],
  )

  useEffect(() => {
    let cancelled = false
    boardApi
      .draw(board, 0)
      .then((page) => {
        if (cancelled) return
        cursor.current = page.cursor
        apply(page.strokes)
        onBanned(page.banned_until)
        setLoaded(true)
      })
      .catch((err) => !cancelled && flash(errorText(err, true)))
    return () => {
      cancelled = true
    }
  }, [board, apply, onBanned, flash])

  usePolling(async () => {
    const page = await boardApi.draw(board, cursor.current)
    cursor.current = page.cursor
    apply(page.strokes)
    onBanned(page.banned_until)
  }, loaded)

  const track = (delta: number) => setBusy((n) => n + delta)

  const finishStroke = () => {
    const points = current.current
    current.current = null
    if (!points) return
    const { color, width } = style.current
    const id = nextTempId.current--
    pending.current.set(id, { id, c: color, w: width, p: points, mine: true })
    redraw()
    track(1)
    boardApi
      .stroke(board, color, width, points)
      .then(({ stroke }) => void strokes.current.set(stroke.id, stroke))
      .catch((err) => flash(errorText(err, true)))
      .finally(() => {
        pending.current.delete(id)
        track(-1)
        redraw()
      })
  }

  const addPoint = (x: number, y: number) => {
    const p = current.current
    if (!p || Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_STEP) return
    p.push(x, y)
    // длинную линию делим на несколько штрихов — у бота лимит точек на штрих
    if (p.length / 2 >= config.points_per_stroke) {
      finishStroke()
      current.current = [x, y]
    }
  }

  const eraseAt = (x: number, y: number) => {
    for (const s of strokes.current.values()) {
      if ((s.mine || admin) && !erasing.current.has(s.id) && hits(s, x, y)) erasing.current.add(s.id)
    }
  }

  const commitErase = () => {
    const ids = [...erasing.current].slice(0, 500)
    if (!ids.length) return
    track(1)
    boardApi
      .erase(board, ids)
      .then((res) => res.ids.forEach((id) => strokes.current.delete(id)))
      .catch((err) => flash(errorText(err, true)))
      .finally(() => {
        ids.forEach((id) => erasing.current.delete(id))
        track(-1)
        redraw()
      })
  }

  const toPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect()
    const clamp = (v: number) => Math.min(SIZE, Math.max(0, Math.round(v)))
    return [clamp(((e.clientX - rect.left) / rect.width) * SIZE), clamp(((e.clientY - rect.top) / rect.height) * SIZE)]
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (banned || !loaded || pointer.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointer.current = e.pointerId
    const [x, y] = toPoint(e)
    if (tool === 'pen') current.current = [x, y]
    else eraseAt(x, y)
    redraw()
  }

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointer.current) return
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (const ev of coalesced.length ? coalesced : [e.nativeEvent]) {
      const [x, y] = toPoint(ev)
      if (tool === 'pen') addPoint(x, y)
      else eraseAt(x, y)
    }
    redraw()
  }

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointer.current) return
    pointer.current = null
    if (tool === 'pen') finishStroke()
    else commitErase()
  }

  const undo = async () => {
    track(1)
    try {
      const { id } = await boardApi.undo(board)
      if (id === null) flash('Отменять нечего')
      else strokes.current.delete(id)
      haptic('light')
      redraw()
    } catch (err) {
      flash(errorText(err, true))
    } finally {
      track(-1)
    }
  }

  // админ: перед очисткой — снимок холста в PNG (бот сохранит его в архив)
  const clear = async () => {
    if (!(await confirmAction('Очистить холст для всех? Снимок сохранится в архиве.'))) return
    const snapshot = document.createElement('canvas')
    snapshot.width = SIZE
    snapshot.height = SIZE
    const ctx = snapshot.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SIZE, SIZE)
    for (const s of strokes.current.values()) paint(ctx, s, 1)
    track(1)
    try {
      const res = await boardApi.clear(board, snapshot.toDataURL('image/png'))
      strokes.current.clear()
      redraw()
      flash(`Холст очищен, снимок №${res.snapshot} в архиве`)
    } catch (err) {
      flash(errorText(err, true))
    } finally {
      track(-1)
    }
  }

  return (
    <div className="draw">
      <div className="draw-frame">
        <canvas
          ref={canvas}
          className={`draw-canvas${tool === 'eraser' ? ' is-eraser' : ''}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {!loaded && <p className="draw-loading">Загружаю холст…</p>}
      </div>
      {notice && <p className="board-notice">{notice}</p>}
      {banned ? (
        <BanNotice until={bannedUntil!} />
      ) : (
        <>
          <div className="draw-colors" role="radiogroup" aria-label="Цвет">
            {config.colors.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={tool === 'pen' && c === color}
                aria-label={COLOR_NAMES[i] ?? c}
                className="swatch"
                style={{ background: c }}
                onClick={() => {
                  haptic()
                  setColor(c)
                  setTool('pen')
                }}
              />
            ))}
          </div>
          <div className="draw-tools">
            <div className="draw-widths" role="radiogroup" aria-label="Толщина">
              {config.widths.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={tool === 'pen' && w === width}
                  aria-label={WIDTH_NAMES[i] ?? String(w)}
                  className="width-btn"
                  onClick={() => {
                    haptic()
                    setWidth(w)
                    setTool('pen')
                  }}
                >
                  <span style={{ width: 4 + i * 5, height: 4 + i * 5, background: tool === 'pen' ? color : undefined }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="tool-btn"
              aria-pressed={tool === 'eraser'}
              onClick={() => {
                haptic()
                setTool(tool === 'eraser' ? 'pen' : 'eraser')
              }}
            >
              <EraserIcon /> Ластик
            </button>
            <button type="button" className="tool-btn" disabled={busy > 0} onClick={undo}>
              <UndoIcon /> Отменить
            </button>
          </div>
          <p className="section-footer">
            {admin ? 'Ластик админа стирает любые штрихи.' : 'Ластик стирает только твои штрихи. Холст общий — рисуй по-доброму.'}
          </p>
        </>
      )}
      {admin && (
        <button type="button" className="button-secondary button-danger" disabled={!loaded || busy > 0} onClick={clear}>
          Очистить холст
        </button>
      )}
    </div>
  )
}
