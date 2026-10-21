import { useEffect, useState } from 'react'
import { Section } from '../components/Section'
import { groupInfo, loadSessionStatus } from '../data'
import { ExternalIcon } from '../icons'
import { dataUrl } from '../schedule'
import { openLink } from '../telegram'
import { t, tn } from '../i18n'
import { sessionPageText } from '../guu'

// «Другое → Документы»: исходные таблицы ГУУ, из которых собрано расписание (parse_report.json, update.py)

type FileRow = {
  kind: string
  name: string
  text: string
  section: string | null
  url: string
  groups?: number
  status?: string
  year?: string | null // сессия: учебный год по датам в файле
  archive?: boolean // сессия прошлого учебного года — группам не показывается
}

const shortYear = (year: string) => year.replace(/^(\d{4})\/\d{2}(\d{2})$/, '$1/$2')

// раздел страницы guu.ru (как в update.py) → заголовок
const sections = (): [string, string][] => [
  ['бакалавриат', t('Бакалавриат')], // i18n-ignore — ключ раздела
  ['магистратура', t('Магистратура')], // i18n-ignore
  ['аспирантура', t('Аспирантура')], // i18n-ignore
]

const label = (f: FileRow) => {
  const text = f.text || f.name.replace(/\.(xlsx|docx?)$/i, '').replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function DocumentsPage({ group }: { group: string }) {
  const [files, setFiles] = useState<FileRow[] | null>(null)
  const [error, setError] = useState(false)
  const [mineFile, setMineFile] = useState<string | null>(null)
  const [sessionPage, setSessionPage] = useState<string | null>(null)

  useEffect(() => {
    fetch(dataUrl('parse_report.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ files: FileRow[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setFiles(d.files), () => setError(true))
    if (!group.startsWith('t-')) groupInfo(group).then((g) => setMineFile(g?.source_file ?? null), () => {})
    loadSessionStatus().then((s) => setSessionPage(s.page), () => {})
  }, [group])

  if (error) return <p className="lead">{t('Не получилось загрузить список. Проверь интернет.')}</p>
  if (!files) return <p className="lead">{t('Загружаю…')}</p>

  const row = (f: FileRow) => (
    <button key={f.url} type="button" className="row row-btn kug-row" onClick={() => openLink(f.url)}>
      <span className="kug-row-text">
        <span className="kug-title">
          <span lang="ru">{label(f)}</span>
          {f.name === mineFile && <span className="badge badge-mine">{t('твоя группа')}</span>}
          {f.kind === 'session' && f.archive && f.year && <span className="badge badge-archive">{t('архив {year}', { year: shortYear(f.year) })}</span>}
        </span>
        <span className="kug-sub">
          <span lang="ru">{f.name}</span>
          {f.groups ? ` · ${tn(f.groups, '{n} группа|{n} группы|{n} групп')}` : ''}
        </span>
      </span>
      <ExternalIcon className="row-check" />
    </button>
  )

  return (
    <>
      <p className="section-footer rooms-note">{t('Таблицы с сайта ГУУ, из которых собрано расписание в приложении. Проверяем их каждый час.')}</p>
      {sections().map(([key, title]) => {
        const list = files.filter((f) => f.kind === 'schedule' && f.section === key)
        return list.length ? (
          <Section key={key} title={t('Расписание · {section}', { section: title })}>
            {list.map(row)}
          </Section>
        ) : null
      })}
      {files.some((f) => f.kind === 'session') && (
        <Section
          title={t('Сессия')}
          footer={
            files.filter((f) => f.kind === 'session').every((f) => f.archive)
              ? t('Это сессия прошлого учебного года: её группы уже на следующем курсе, в приложении она не показывается.')
              : undefined
          }
        >
          {files.filter((f) => f.kind === 'session').map(row)}
        </Section>
      )}
      <Section>
        <button type="button" className="row row-btn row-link" onClick={() => openLink('https://guu.ru/student/schedule/')}>
          <span>{t('Страница расписания на guu.ru')}</span>
          <ExternalIcon className="row-check" />
        </button>
        <button type="button" className="row row-btn row-link kug-row" onClick={() => openLink('https://guu.ru/student/session/')}>
          <span className="kug-row-text">
            <span>{t('Страница сессии на guu.ru')}</span>
            {sessionPage && <span className="kug-sub">{t('сейчас там {what}', { what: sessionPageText(sessionPage) })}</span>}
          </span>
          <ExternalIcon className="row-check" />
        </button>
      </Section>
    </>
  )
}
