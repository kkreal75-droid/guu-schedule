import { useState } from 'react'
import { Section } from '../components/Section'
import { ChevronLeft, ChevronRight } from '../icons'
import { CampusMap, onCampusMap } from '../more/CampusMap'
import {
  PLACE_GROUPS, forgetPlaces, loadCampus, loadPlacesFile, mapApps, mergePlaces, type CampusMap as MapData, type Place,
  type PlaceEdit, type PlaceGroup,
} from '../places'
import { confirmAction, haptic, openLink } from '../telegram'
import { adminApi, adminError } from './api'
import { Loading, useFlash, useLoad } from './common'

// «Админ-панель → Места» (этап 7.7): места «Корпусов ГУУ». Файл public/data/places.json — в репозитории;
// здесь — правки поверх него и новые места (D1 place_edits, всем видны через минуту). «todo» из файла —
// что не проверено: видит только владелец, очистить поле — отметить проверенным.

type Data = { file: Place[]; edits: PlaceEdit[]; map: MapData | null }

async function loadAll(): Promise<Data> {
  const [file, { edits }, map] = await Promise.all([loadPlacesFile(), adminApi.places(), loadCampus().catch(() => null)])
  return { file, edits, map }
}

export function PlacesAdmin() {
  const { data, setData, error } = useLoad(loadAll)
  const [open, setOpen] = useState<string | 'new' | null>(null)
  if (!data) return <Loading error={error ? adminError(error) : null} />

  const onEdits = (edits: PlaceEdit[]) => {
    forgetPlaces()
    setData({ ...data, edits })
  }

  if (open !== null) {
    const base = open === 'new' ? null : (data.file.find((p) => p.id === open) ?? null)
    const edit = open === 'new' ? null : (data.edits.find((e) => e.id === open) ?? null)
    return (
      <PlaceEditor
        key={open}
        base={base}
        edit={edit}
        map={data.map}
        onBack={() => setOpen(null)}
        onSaved={(id, edits) => (onEdits(edits), setOpen(id))}
        onReset={(edits) => (onEdits(edits), setOpen(null))}
      />
    )
  }

  const shown = mergePlaces(data.file, data.edits)
  const hidden = data.edits.filter((e) => e.data.hidden)
  const todo = shown.filter((p) => p.todo)
  const row = (p: Place, label?: string) => (
    <button key={p.id} type="button" className="row row-btn row-nav" onClick={() => (haptic(), setOpen(p.id))}>
      <span className="row-icon">{p.icon}</span>
      <span className="row-label">
        {p.short ? `${p.name} (${p.short})` : p.name}
        {p.todo && <span className="badge-file badge-todo">не проверено</span>}
      </span>
      <span className="row-value">{label ?? (p.custom ? 'новое' : p.edited ? 'правка' : '')}</span>
      <ChevronRight className="row-chevron" />
    </button>
  )

  return (
    <div className="page-body">
      <Section
        title={`Не проверено · ${todo.length}`}
        footer="Что стоит проверить на месте (координаты входа, этажи, часы работы). Поправь место и очисти поле «Не проверено»."
      >
        {todo.length ? todo.map((p) => row(p)) : <div className="row row-text">Всё проверено 🎉</div>}
      </Section>
      {PLACE_GROUPS.map((g) => (
        <Section key={g.id} title={g.title}>
          {shown.filter((p) => p.group === g.id).map((p) => row(p))}
          {g.id === 'other' && (
            <button type="button" className="row row-btn row-link" onClick={() => (haptic(), setOpen('new'))}>
              <span>+ Добавить место</span>
            </button>
          )}
        </Section>
      ))}
      {hidden.length > 0 && (
        <Section title="Скрытые">
          {hidden.map((e) => {
            const p = data.file.find((f) => f.id === e.id)
            return p ? row(p, 'скрыто') : null
          })}
        </Section>
      )}
      <p className="section-footer">
        Места из файла public/data/places.json (в репозитории) + правки отсюда. Пользователи видят изменения через минуту.
      </p>
    </div>
  )
}

// ---------- одно место ----------

type EditorProps = {
  base: Place | null // из файла (null — новое место)
  edit: PlaceEdit | null
  map: MapData | null
  onBack: () => void
  onSaved: (id: string, edits: PlaceEdit[]) => void
  onReset: (edits: PlaceEdit[]) => void
}

const toForm = (p: Partial<Place> & { hidden?: boolean }) => ({
  name: p.name ?? '',
  short: p.short ?? '',
  icon: p.icon ?? '',
  group: (p.group ?? 'other') as PlaceGroup,
  address: p.address ?? '',
  coords: typeof p.lat === 'number' && typeof p.lon === 'number' ? `${p.lat}, ${p.lon}` : '',
  howto: p.howto ?? '',
  note: p.note ?? '',
  todo: p.todo ?? '',
  rooms: (p.rooms ?? []).join(', '),
  aliases: (p.aliases ?? []).join(', '),
  hidden: Boolean(p.hidden),
})

// «55.7140, 37.8115» или ссылка с ll=/query= — широта и долгота
function parseCoords(text: string): [number, number] | null {
  const nums = text.match(/-?\d+\.\d+/g)?.map(Number) ?? []
  if (nums.length < 2) return null
  let [a, b] = nums
  if (a > 30 && a < 40 && b > 50 && b < 60) [a, b] = [b, a] // Яндекс пишет «долгота,широта»
  return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null
}

const splitList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)

function PlaceEditor({ base, edit, map, onBack, onSaved, onReset }: EditorProps) {
  const [form, setForm] = useState(() => toForm({ ...(base ?? {}), ...(edit?.data ?? {}) }))
  const [busy, setBusy] = useState(false)
  const [flash, notice] = useFlash()
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const coords = parseCoords(form.coords)
  const preview: Place | null = coords
    ? { ...(base ?? ({} as Place)), id: base?.id ?? 'new', name: form.name || 'Место', short: form.short || null, icon: form.icon || '📍', group: form.group, lat: coords[0], lon: coords[1], rooms: [], aliases: [], howto: '', address: '', note: null, todo: null }
    : null

  const save = async () => {
    setBusy(true)
    try {
      const res = await adminApi.placeSave(base?.id ?? edit?.id ?? null, {
        name: form.name, short: form.short, icon: form.icon, group: form.group, address: form.address,
        lat: coords?.[0] ?? null, lon: coords?.[1] ?? null, howto: form.howto, note: form.note, todo: form.todo,
        rooms: splitList(form.rooms), aliases: splitList(form.aliases), hidden: form.hidden,
      })
      haptic('light')
      flash('Сохранено')
      onSaved(res.id, res.edits)
    } catch (err) {
      flash(adminError(err))
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    const id = base?.id ?? edit?.id
    if (!id) return
    const question = base ? 'Вернуть место как в файле? Правки отсюда пропадут.' : 'Удалить это место?'
    if (!(await confirmAction(question))) return
    setBusy(true)
    try {
      onReset((await adminApi.placeReset(id)).edits)
    } catch (err) {
      flash(adminError(err))
      setBusy(false)
    }
  }

  return (
    <div className="page-body">
      <button type="button" className="page-back admin-sub-back" onClick={onBack}>
        <ChevronLeft /> Все места
      </button>
      {notice}
      <Section title={base ? (edit ? 'Место из файла · есть правка' : 'Место из файла') : edit ? 'Новое место (из админки)' : 'Новое место'}>
        <div className="form">
          <label className="field">
            <span>Название</span>
            <input className="input" value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Лабораторный корпус" />
          </label>
          <div className="form-2col">
            <label className="field">
              <span>Сокращение</span>
              <input className="input" value={form.short} maxLength={12} onChange={(e) => set({ short: e.target.value })} placeholder="ЛК" />
            </label>
            <label className="field">
              <span>Иконка (эмодзи)</span>
              <input className="input" value={form.icon} maxLength={8} onChange={(e) => set({ icon: e.target.value })} placeholder="📍" />
            </label>
          </div>
          <div className="row-chips">
            {PLACE_GROUPS.map((g) => (
              <button key={g.id} type="button" className="chip" aria-pressed={form.group === g.id} onClick={() => set({ group: g.id })}>
                {g.title}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Адрес</span>
            <input className="input" value={form.address} maxLength={160} onChange={(e) => set({ address: e.target.value })} placeholder="Рязанский проспект, 99, стр. 4" />
          </label>
          <label className="field">
            <span>Координаты входа: широта, долгота</span>
            <input className="input" value={form.coords} onChange={(e) => set({ coords: e.target.value })} placeholder="55.713667, 37.815178" inputMode="decimal" />
            {form.coords && !coords && <span className="form-error">Не понял координаты</span>}
          </label>
          {map && preview && onCampusMap(map, preview) && <CampusMap map={map} places={[]} focus={preview} />}
          {coords && (
            <button type="button" className="chip" onClick={() => openLink(mapApps({ lat: coords[0], lon: coords[1], name: form.name }).find((a) => a.id === 'yandex')!.url)}>
              Проверить в Яндекс Картах
            </button>
          )}
          <label className="field">
            <span>Как пройти (каждая строка — пункт)</span>
            <textarea className="input textarea" rows={5} value={form.howto} maxLength={1500} onChange={(e) => set({ howto: e.target.value })} />
          </label>
          <label className="field">
            <span>Заметка (часы работы и т. п.)</span>
            <input className="input" value={form.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} />
          </label>
          <label className="field">
            <span>Префиксы аудиторий через запятую (У-432 → «У»; «Актовый зал» — целиком)</span>
            <input className="input" value={form.rooms} onChange={(e) => set({ rooms: e.target.value })} placeholder="ЛК" />
          </label>
          <label className="field">
            <span>Другие названия для поиска, через запятую</span>
            <input className="input" value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} placeholder="лабораторный" />
          </label>
          <label className="field">
            <span>Не проверено (видишь только ты)</span>
            <input className="input" value={form.todo} maxLength={300} onChange={(e) => set({ todo: e.target.value })} placeholder="пусто — всё проверено" />
          </label>
          {base && (
            <label className="row row-switch">
              <span className="row-label">Скрыть место</span>
              <input type="checkbox" className="switch" checked={form.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
            </label>
          )}
          <div className="row-chips">
            <button type="button" className="chip chip-accent" disabled={busy || (!form.hidden && (form.name.trim().length < 2 || !coords))} onClick={save}>
              Сохранить
            </button>
            {edit && (
              <button type="button" className="chip chip-danger" disabled={busy} onClick={reset}>
                {base ? 'Вернуть как в файле' : 'Удалить место'}
              </button>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}
