import { useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { groupInfo } from '../data'
import { ExternalIcon } from '../icons'
import { dataUrl } from '../schedule'
import { openLink } from '../telegram'

// «Другое → Документы»: исходные таблицы ГУУ, из которых собрано расписание (parse_report.json, update.py)

type FileRow = { kind: string; name: string; text: string; section: string | null; url: string; groups?: number; status?: string }

const SECTIONS: [string, string][] = [
  ['бакалавриат', 'Бакалавриат'],
  ['магистратура', 'Магистратура'],
  ['аспирантура', 'Аспирантура'],
]

const label = (f: FileRow) => {
  const t = f.text || f.name.replace(/\.(xlsx|docx?)$/i, '').replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function DocumentsPage({ group }: { group: string }) {
  const [files, setFiles] = useState<FileRow[] | null>(null)
  const [error, setError] = useState(false)
  const [mineFile, setMineFile] = useState<string | null>(null)

  useEffect(() => {
    fetch(dataUrl('parse_report.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ files: FileRow[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setFiles(d.files), () => setError(true))
    if (!group.startsWith('t-')) groupInfo(group).then((g) => setMineFile(g?.source_file ?? null), () => {})
  }, [group])

  if (error) return <p className="lead">Не получилось загрузить список. Проверь интернет.</p>
  if (!files) return <p className="lead">Загружаю…</p>

  const row = (f: FileRow) => (
    <button key={f.url} type="button" className="row row-btn kug-row" onClick={() => openLink(f.url)}>
      <span className="kug-row-text">
        <span className="kug-title">
          {label(f)}
          {f.name === mineFile && <span className="badge badge-mine">твоя группа</span>}
        </span>
        <span className="kug-sub">
          {f.name}
          {f.groups ? ` · групп: ${f.groups}` : ''}
        </span>
      </span>
      <ExternalIcon className="row-check" />
    </button>
  )

  return (
    <>
      <p className="section-footer rooms-note">Таблицы с сайта ГУУ, из которых собрано расписание в приложении. Проверяем их каждый час.</p>
      {SECTIONS.map(([key, title]) => {
        const list = files.filter((f) => f.kind === 'schedule' && f.section === key)
        return list.length ? (
          <Section key={key} title={`Расписание · ${title}`}>
            {list.map(row)}
          </Section>
        ) : null
      })}
      {files.some((f) => f.kind === 'session') && <Section title="Сессия">{files.filter((f) => f.kind === 'session').map(row)}</Section>}
      <Section>
        <button type="button" className="row row-btn row-link" onClick={() => openLink('https://guu.ru/student/schedule/')}>
          <span>Страница расписания на guu.ru</span>
          <ExternalIcon className="row-check" />
        </button>
        <button type="button" className="row row-btn row-link" onClick={() => openLink('https://guu.ru/student/session/')}>
          <span>Страница сессии на guu.ru</span>
          <ExternalIcon className="row-check" />
        </button>
      </Section>
    </>
  )
}
