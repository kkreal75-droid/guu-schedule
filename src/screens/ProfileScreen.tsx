import { Section } from '../components/Section'
import { Segmented } from '../components/Segmented'
import { formatFullDate, weekTitle } from '../format'
import { isMbGroup } from '../../shared/groups'
import { useGroupNames } from '../data'
import { ChevronRight, CloseIcon, ExternalIcon } from '../icons'
import type { Prefs, ThemeMode } from '../prefs'
import { MAX_WEEK, START_DAY, groupName, inSemester, moscowNow, schedule, weekOf } from '../schedule'
import { cloudAvailable } from '../storage'
import { haptic, inTelegram, openLink, telegramUser } from '../telegram'

const SOURCE_URL = 'https://guu.ru/student/schedule/'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Системная' },
  { value: 'dark', label: 'Тёмная' },
]

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
  onChangeProfile: () => void // «Сменить группу / роль» — снова онбординг
  noteCount: number
}

export function ProfileScreen({ prefs, onChange, onChangeProfile, noteCount }: Props) {
  const teacher = prefs.role === 'teacher' && prefs.teacher
  const favorites = prefs.favorites
  const nameOf = useGroupNames()
  const week = weekOf(moscowNow().day)
  // «1-курс-бакалавриат-ОФО-141.xlsx» → «141»
  const sourceVersion = schedule.source_file?.match(/-(\d+)\.xlsx$/)?.[1]

  return (
    <div className="screen profile">
      <UserCard />

      <Section
        title="Расписание"
        footer={
          teacher
            ? 'Главный экран — ваши пары по файлам ГУУ.'
            : isMbGroup(prefs.group)
              ? 'Открывается при запуске. На экране расписания можно переключиться между 1-1 и 1-2.'
              : 'Открывается при запуске.'
        }
      >
        <div className="row">
          <span>{teacher ? 'Преподаватель' : 'Моя группа'}</span>
          <span className="row-value">{teacher ? (prefs.teacherName ?? groupName(`t-${prefs.teacher}`)) : groupName(prefs.group)}</span>
        </div>
        <button
          type="button"
          className="row row-btn row-link"
          onClick={() => {
            haptic()
            onChangeProfile()
          }}
        >
          <span>Сменить группу / роль</span>
          <ChevronRight className="row-check" />
        </button>
      </Section>

      {favorites.length > 0 && (
        <Section title="Избранные группы" footer="Видны над расписанием рядом со своей. Добавить — «Ещё → Расписание группы».">
          {favorites.map((g) => (
            <div key={g} className="row">
              <span>{nameOf(g)}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Убрать ${nameOf(g)} из избранного`}
                onClick={() => {
                  haptic()
                  onChange({ favorites: prefs.favorites.filter((f) => f !== g) })
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </Section>
      )}

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
        {schedule.source_file && (
          <div className="row">
            <span>Файл ГУУ</span>
            <span className="row-value">{sourceVersion ? `№${sourceVersion}` : schedule.source_file}</span>
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
