import type { ReactNode } from 'react'
import source from '../../data/source.json'
import { Segmented } from '../components/Segmented'
import { formatFullDate, weekTitle } from '../format'
import { CheckIcon, ExternalIcon } from '../icons'
import type { Prefs, ThemeMode } from '../prefs'
import { MAX_WEEK, START_DAY, inSemester, moscowNow, schedule, weekOf } from '../schedule'
import { cloudAvailable } from '../storage'
import { haptic, inTelegram, openLink, telegramUser } from '../telegram'

const SOURCE_URL = 'https://guu.ru/student/schedule/'

// data/source.json пишет update.py: какой файл ГУУ сейчас в расписании и когда ГУУ его менял
const sourceVersion = source.file.match(/-(\d+)\.xlsx$/)?.[1]
const sourceChanged = source.last_modified
  ? new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(source.last_modified))
  : null

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Системная' },
  { value: 'dark', label: 'Тёмная' },
]

function Section({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      <div className="section-body">{children}</div>
      {footer && <p className="section-footer">{footer}</p>}
    </section>
  )
}

function UserCard() {
  const user = telegramUser()
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Гость'
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
  return (
    <div className="user-card">
      {user?.photo_url ? (
        <img className="avatar" src={user.photo_url} alt="" />
      ) : (
        <div className="avatar avatar-initials">{initials}</div>
      )}
      <div className="user-text">
        <div className="user-name">{name}</div>
        <div className="user-sub">
          {user?.username
            ? `@${user.username}`
            : inTelegram
              ? 'Настройки синхронизируются через Telegram'
              : 'Откройте через Telegram — настройки будут синхронизироваться'}
        </div>
      </div>
    </div>
  )
}

type Props = {
  prefs: Prefs
  onChange: (patch: Partial<Prefs>) => void
  noteCount: number
}

export function ProfileScreen({ prefs, onChange, noteCount }: Props) {
  const week = weekOf(moscowNow().day)

  return (
    <div className="screen profile">
      <UserCard />

      <Section
        title="Группа по умолчанию"
        footer="Открывается при запуске. На экране расписания группу можно переключить в любой момент."
      >
        {schedule.groups.map((g) => (
          <button
            key={g}
            type="button"
            className="row row-btn"
            role="radio"
            aria-checked={g === prefs.group}
            onClick={() => {
              if (g === prefs.group) return
              haptic()
              onChange({ group: g })
            }}
          >
            <span>{g}</span>
            {g === prefs.group && <CheckIcon className="row-check" />}
          </button>
        ))}
      </Section>

      <Section
        title="Тема"
        footer={inTelegram ? 'Системная — как в Telegram.' : 'Системная — как в настройках устройства.'}
      >
        <div className="row row-plain">
          <Segmented
            label="Тема оформления"
            value={prefs.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => onChange({ theme })}
          />
        </div>
      </Section>

      <Section
        title="Заметки"
        footer={
          cloudAvailable()
            ? 'Хранятся в облаке Telegram и видны на всех ваших устройствах.'
            : 'Вне Telegram заметки хранятся только в этом браузере.'
        }
      >
        <div className="row">
          <span>Всего заметок</span>
          <span className="row-value">{noteCount}</span>
        </div>
      </Section>

      <Section title="Семестр" footer="Новый файл расписания на guu.ru проверяем каждый час.">
        <div className="row">
          <span>Сейчас</span>
          <span className="row-value">
            {inSemester(week) ? weekTitle(week).toLowerCase() : week < 1 ? 'семестр не начался' : 'семестр окончен'}
          </span>
        </div>
        <div className="row">
          <span>Первая неделя</span>
          <span className="row-value">с {formatFullDate(START_DAY)}</span>
        </div>
        <div className="row">
          <span>Недель в расписании</span>
          <span className="row-value">{MAX_WEEK}</span>
        </div>
        {sourceChanged && (
          <div className="row">
            <span>Файл ГУУ{sourceVersion ? ` №${sourceVersion}` : ''}</span>
            <span className="row-value">от {sourceChanged}</span>
          </div>
        )}
        <button type="button" className="row row-btn row-link" onClick={() => openLink(SOURCE_URL)}>
          <span>Расписание на guu.ru</span>
          <ExternalIcon className="row-check" />
        </button>
      </Section>
    </div>
  )
}
