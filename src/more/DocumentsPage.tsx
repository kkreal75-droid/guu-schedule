import { useEffect, useState } from 'react'
import { Row } from '../components/Row'
import { Section } from '../components/Section'
import { groupInfo, loadSessionStatus } from '../data'
import { dataUrl } from '../schedule'
import { openLink } from '../telegram'
import { t, tn } from '../i18n'
import { sessionPageText } from '../guu'

// «Сервисы → Документы»: исходные таблицы ГУУ, из которых собрано расписание (parse_report.json, update.py).
// Понятные названия «1 курс, очная» вместо «1 курс бакалавриат офо», у своего файла — серая плашка «твоя группа».

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

// i18n-ignore — разбираем подписи файлов guu.ru
const label = (f: FileRow) => {
  const text = (f.text || f.name.replace(/\.(xlsx|docx?)$/i, '').replace(/-/g, ' ')).replace(/^сессия\s+/i, '')
  const lower = text.toLowerCase()
  const course = lower.match(/(\d)(?:\s*-\s*(\d))?\s*курс/) // i18n-ignore
  // «1 курс, очная»: только у обычных файлов (у программ на английском и прочих — подпись как на сайте)
  if (course && !/англ|умб/.test(lower)) { // i18n-ignore
    const form = /озфо/.test(lower) ? t('очно-заочная') : /офо/.test(lower) ? t('очная') : null // i18n-ignore
    return [t('{n} курс', { n: course[2] ? `${course[1]}–${course[2]}` : course[1] }), form].filter(Boolean).join(', ')
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// «1-курс-бакалавриат-ОФО-143.xlsx» → «…ОФО-143.xlsx»
const tail = (name: string) => `…${name.split('-').slice(-2).join('-')}`

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

  const row = (f: FileRow) => {
    const mine = f.name === mineFile
    return (
      <Row
        key={f.url}
        title={
          <>
            <span lang="ru">{label(f)}</span>
            {mine && <span className="doc-mark">{t('твоя группа')}</span>}
            {f.kind === 'session' && f.archive && f.year && <span className="doc-mark doc-mark-grey">{t('архив {year}', { year: shortYear(f.year) })}</span>}
          </>
        }
        sub={
          <>
            <span lang="ru">{mine ? f.name : tail(f.name)}</span>
            {!mine && f.groups ? ` · ${tn(f.groups, '{n} группа|{n} группы|{n} групп')}` : ''}
          </>
        }
        out
        onClick={() => openLink(f.url)}
      />
    )
  }

  return (
    <>
      <p className="page-lead">{t('Таблицы с сайта ГУУ, из которых собрано расписание. Проверяем их каждый час.')}</p>
      {sections().map(([key, title]) => {
        const list = files.filter((f) => f.kind === 'schedule' && f.section === key)
        return list.length ? (
          <Section key={key} title={title}>
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
        <Row title={t('Страница расписания на guu.ru')} out onClick={() => openLink('https://guu.ru/student/schedule/')} />
        <Row
          title={t('Страница сессии на guu.ru')}
          sub={sessionPage ? t('сейчас там {what}', { what: sessionPageText(sessionPage) }) : undefined}
          out
          onClick={() => openLink('https://guu.ru/student/session/')}
        />
      </Section>
    </>
  )
}
