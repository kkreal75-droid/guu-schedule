import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '../components/Segmented'
import { Section } from '../components/Section'
import { fetchData, loadGroups } from '../data'
import { forgetTranslations } from '../guu'
import { haptic } from '../telegram'
import { adminApi, adminError, type TranslationEdit, type TranslationKind } from './api'
import { Loading, useFlash } from './common'

// «Админ-панель → Переводы» (этап 11): английские названия для английской версии. Словари — в репозитории
// (data/i18n/subjects.en.json, data/i18n/guu.en.json), здесь — правки поверх них (D1, видны сразу всем).
// Новые предметы без перевода бот присылает владельцу после автообновления — они здесь сверху.
type Names = { institutes: Record<string, string>; directions: Record<string, string>; programs: Record<string, string> }
type Data = { subjects: string[]; dict: Record<TranslationKind, Record<string, string>>; lists: Record<TranslationKind, string[]> }

const KINDS: { value: TranslationKind; label: string }[] = [
  { value: 'subject', label: 'Предметы' },
  { value: 'program', label: 'Программы' },
  { value: 'direction', label: 'Направления' },
  { value: 'institute', label: 'Институты' },
]
const PAGE = 60

export function TranslationsAdmin() {
  const [data, setData] = useState<Data | null>(null)
  const [edits, setEdits] = useState<TranslationEdit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<TranslationKind>('subject')
  const [query, setQuery] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [flash, notice] = useFlash()

  useEffect(() => {
    Promise.all([
      fetchData<{ subjects: string[] }>('subjects.json'),
      fetchData<Record<string, string>>('i18n/subjects.en.json'),
      fetchData<Names>('i18n/guu.en.json'),
      loadGroups(),
      adminApi.translations(),
    ]).then(
      ([subjects, dict, names, groups, res]) => {
        const uniq = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ru'))
        setData({
          subjects: subjects.subjects,
          dict: { subject: dict, institute: names.institutes, direction: names.directions, program: names.programs },
          lists: {
            subject: subjects.subjects,
            institute: Object.keys(groups.institutes),
            direction: uniq(groups.groups.map((g) => g.direction)),
            program: uniq(groups.groups.map((g) => g.program)),
          },
        })
        setEdits(res.edits)
      },
      (err) => setError(adminError(err)),
    )
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const edited = new Map(edits.filter((e) => e.kind === kind).map((e) => [e.ru, e.en]))
    const q = query.trim().toLowerCase()
    return data.lists[kind]
      .map((ru) => ({ ru, file: data.dict[kind][ru] ?? (kind === 'program' ? data.dict.direction[ru] : undefined) ?? '', edit: edited.get(ru) ?? null }))
      .filter((r) => (!q || r.ru.toLowerCase().includes(q) || (r.edit ?? r.file).toLowerCase().includes(q)) && (!onlyMissing || !(r.edit ?? r.file)))
      .sort((a, b) => Number(Boolean(a.edit ?? a.file)) - Number(Boolean(b.edit ?? b.file)))
  }, [data, edits, kind, query, onlyMissing])

  if (!data) return <Loading error={error} />
  const missing = data.lists[kind].filter((ru) => !edits.some((e) => e.kind === kind && e.ru === ru) && !data.dict[kind][ru] && !(kind === 'program' && data.dict.direction[ru])).length

  const save = async (ru: string, en: string) => {
    try {
      const res = await adminApi.translationSave(kind, ru, en)
      setEdits(res.edits)
      forgetTranslations()
      haptic('light')
      flash(en ? 'Сохранено' : 'Вернул перевод из словаря')
    } catch (err) {
      flash(adminError(err))
    }
  }

  return (
    <div className="page-body">
      <Segmented label="Что переводим" value={kind} options={KINDS} onChange={(k) => (setKind(k), setLimit(PAGE))} />
      <Section
        title={`${KINDS.find((k) => k.value === kind)!.label}: ${data.lists[kind].length}, без перевода: ${missing}`}
        footer="Пустое поле и «Сохранить» — вернуть перевод из словаря в репозитории. Видно в английской версии через минуту."
      >
        <div className="row row-form">
          <input className="input" type="search" placeholder="Поиск по-русски или по-английски" value={query} onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))} />
        </div>
        <label className="row row-switch">
          <span className="row-label">Только без перевода</span>
          <input type="checkbox" className="switch" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        </label>
        {rows.slice(0, limit).map((r) => (
          <TranslationRow key={r.ru} ru={r.ru} file={r.file} edit={r.edit} onSave={save} />
        ))}
        {rows.length > limit && (
          <button type="button" className="row row-btn row-link" onClick={() => setLimit((l) => l + PAGE)}>
            <span>Показать ещё ({rows.length - limit})</span>
          </button>
        )}
      </Section>
      {notice}
    </div>
  )
}

function TranslationRow({ ru, file, edit, onSave }: { ru: string; file: string; edit: string | null; onSave: (ru: string, en: string) => Promise<void> }) {
  const [value, setValue] = useState(edit ?? file)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(edit ?? file), [edit, file])
  const changed = value.trim() !== (edit ?? file)
  return (
    <div className="row">
      <div className="tr-row">
        <span className="tr-ru">
          {ru}
          {edit !== null && <span className="badge badge-edit"> правка</span>}
          {!edit && !file && <span className="badge badge-archive"> без перевода</span>}
        </span>
        <div className="tr-edit">
          <input className="input" value={value} placeholder={file || 'English'} maxLength={300} onChange={(e) => setValue(e.target.value)} />
          <button
            type="button"
            className="chip chip-accent"
            disabled={busy || (!changed && edit === null)}
            onClick={async () => {
              setBusy(true)
              await onSave(ru, value.trim() === file && edit !== null ? '' : value.trim())
              setBusy(false)
            }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
