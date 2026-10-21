import { useCallback, useState } from 'react'
import { Section } from '../components/Section'
import { Segmented } from '../components/Segmented'
import { useGroupNames } from '../data'
import type { Extras } from '../edits'
import { botAvailable, callBot } from '../api'
import { CheckIcon, ChevronLeft, ChevronRight, CloseIcon, ExternalIcon } from '../icons'
import { CalendarPage } from '../more/CalendarPage'
import { AccountForm } from '../onboarding/AccountForm'
import type { Choice } from '../onboarding/Onboarding'
import type { Prefs, ThemeMode } from '../prefs'
import { groupName, isoFromDay, moscowNow, schedule } from '../schedule'
import { WEEKDAYS_SHORT } from '../format'
import { hideScopeTitle } from '../../shared/edits-core'
import type { HiddenLesson } from '../hidden'
import { cloudAvailable } from '../storage'
import { haptic, inTelegram, openLink, telegramUser } from '../telegram'
import { useBackButton } from '../useBackButton'

// «Профиль» (этап 7.8, сверено с profile-28): крупный заголовок, карточка «аватар · имя · @ник · группа»,
// «Параметры аккаунта» (студент / преподаватель + выпадающие списки и «Сохранить»), подгруппы, избранные
// группы, тема, календарь, знакомство ещё раз, о приложении. Подписок и платных функций нет.

const SOURCE_URL = 'https://guu.ru/student/schedule/'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Системная' },
  { value: 'dark', label: 'Тёмная' },
]

function UserCard({ who }: { who: string }) {
  const user = telegramUser()
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Гость'
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
  const sub = [user?.username ? `@${user.username}` : null, who].filter(Boolean).join(' · ')
  return (
    <div className="user-card">
      {user?.photo_url ? (
        <img className="avatar" src={user.photo_url} alt="" />
      ) : (
        <div className="avatar avatar-initials">{initials}</div>
      )}
      <div className="user-text">
        <div className="user-name">{name}</div>
        <div className="user-sub">{sub}</div>
        {!inTelegram && <div className="user-sub">Откройте через Telegram — настройки будут синхронизироваться</div>}
      </div>
    </div>
  )
}

type Props = {
  prefs: Prefs
  onChange: (patch: Partial<Prefs>) => void
  onSaveChoice: (choice: Choice) => Promise<void> // «Параметры аккаунта → Сохранить»
  onSearchGroup: () => void // «Знаю свою группу» — поиск группы
  noteCount: number
  extras: Extras
  hidden: HiddenLesson[] // свои скрытые пары («Это не моя пара»)
  onUnhide: (id: number) => void
  onShowIntro: () => void // «Показать знакомство ещё раз»
}

// «Скрытые пары»: что человек скрыл у себя — вернуть одним нажатием. «Только в этот день» из прошлого не показываем
function HiddenSection({ hidden, home, nameOf, onUnhide }: { hidden: HiddenLesson[]; home: string; nameOf: (g: string) => string; onUnhide: (id: number) => void }) {
  const today = isoFromDay(moscowNow().day)
  const list = hidden.filter((h) => h.scope !== 'day' || (h.date ?? '') >= today)
  return (
    <Section
      title="Скрытые пары"
      footer={
        list.length
          ? 'Скрытые пары не видны ни в приложении, ни в календаре на телефоне, ни в inline. Другим ничего не меняется.'
          : 'Пара не твоя (например, язык у потока в нескольких окнах)? Нажми «⋯» на карточке пары → «Это не моя пара».'
      }
    >
      {list.length === 0 && <div className="row row-text hidden-empty">Ничего не скрыто</div>}
      {list.map((h) => (
        <div key={h.id} className="row">
          <span className="hidden-row">
            <span className="hidden-row-title">{h.subject}</span>
            <span className="hidden-row-sub">
              {[h.group !== home ? nameOf(h.group) : null, `${WEEKDAYS_SHORT[h.weekday]} ${h.start}`, h.kind, hideScopeTitle(h)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <button type="button" className="link-btn" disabled={h.id < 0} onClick={() => (haptic(), onUnhide(h.id))}>
            Вернуть
          </button>
        </div>
      ))}
    </Section>
  )
}

export function ProfileScreen({
  prefs, onChange, onSaveChoice, onSearchGroup, noteCount, extras, hidden, onUnhide, onShowIntro,
}: Props) {
  const [sub, setSub] = useState<'calendar' | null>(null)
  const closeSub = useCallback(() => {
    setSub(null)
    window.scrollTo(0, 0)
  }, [])
  useBackButton(sub ? closeSub : null)

  // подгруппы своей группы (их заводит староста): выбранные — только свои пары
  const ownSubgroups = prefs.role === 'student' ? extras.subgroups.filter((s) => s.group === prefs.group) : []
  const toggleSubgroup = (id: number) => {
    haptic()
    const next = prefs.subgroups.includes(id) ? prefs.subgroups.filter((x) => x !== id) : [...prefs.subgroups, id]
    onChange({ subgroups: next })
    // боту — чтобы /today, inline и календарь тоже показывали только свои пары
    if (botAvailable()) callBot('/my-subgroups', { group: prefs.group, ids: next }).catch(() => {})
  }
  const teacher = prefs.role === 'teacher' && prefs.teacher
  const favorites = prefs.favorites
  const nameOf = useGroupNames()
  // «1-курс-бакалавриат-ОФО-141.xlsx» → «141»
  const sourceVersion = schedule.source_file?.match(/-(\d+)\.xlsx$/)?.[1]
  const who = teacher ? (prefs.teacherName ?? groupName(`t-${prefs.teacher}`)) : groupName(prefs.group)

  if (sub === 'calendar') {
    return (
      <div className="screen more">
        <header className="page-head">
          <button type="button" className="page-back" onClick={closeSub} aria-label="Назад">
            <ChevronLeft /> Профиль
          </button>
          <h2 className="page-title">Календарь на телефоне</h2>
        </header>
        <CalendarPage group={prefs.group} />
      </div>
    )
  }

  return (
    <div className="screen profile">
      <header className="screen-head profile-head">
        <h1 className="screen-title">Профиль</h1>
      </header>

      <UserCard who={who} />

      <AccountForm key={`${prefs.role}:${prefs.group}:${prefs.teacher}`} prefs={prefs} onSave={onSaveChoice} onSearch={onSearchGroup} />

      {ownSubgroups.length > 0 && (
        <Section
          title="Подгруппы"
          footer="Например, по языку. Пары чужих подгрупп не будут показываться. Ничего не выбрано — видно всё."
        >
          {ownSubgroups.map((s) => (
            <button
              key={s.id}
              type="button"
              className="row row-btn"
              role="checkbox"
              aria-checked={prefs.subgroups.includes(s.id)}
              onClick={() => toggleSubgroup(s.id)}
            >
              <span>{s.name}</span>
              {prefs.subgroups.includes(s.id) && <CheckIcon className="row-check" />}
            </button>
          ))}
        </Section>
      )}

      {favorites.length > 0 && (
        <Section title="Избранные группы" footer="Видны над расписанием рядом со своей. Добавить — «+» у групп на главном экране.">
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

      {botAvailable() && (
        <HiddenSection
          hidden={hidden}
          home={teacher ? `t-${prefs.teacher}` : prefs.group}
          nameOf={(g) => (g.startsWith('t-') ? 'расписание преподавателя' : nameOf(g))}
          onUnhide={onUnhide}
        />
      )}

      <Section title="Тема" footer={inTelegram ? 'Системная — как в Telegram.' : 'Системная — как в настройках устройства.'}>
        <div className="row row-plain">
          <Segmented label="Тема оформления" value={prefs.theme} options={THEME_OPTIONS} onChange={(theme) => onChange({ theme })} />
        </div>
      </Section>

      {!teacher && (
        <Section title="Календарь" footer="Пары сами появятся в календаре телефона и будут обновляться.">
          <button type="button" className="row row-btn row-nav" onClick={() => (haptic(), setSub('calendar'), window.scrollTo(0, 0))}>
            <span className="row-label">Календарь на телефоне</span>
            <span className="row-value">Apple / Google</span>
            <ChevronRight className="row-chevron" />
          </button>
        </Section>
      )}

      <Section>
        <button type="button" className="row row-btn row-link" onClick={() => (haptic(), onShowIntro())}>
          <span>Показать знакомство ещё раз</span>
          <ChevronRight className="row-check" />
        </button>
      </Section>

      <Section
        title="О приложении"
        footer={
          cloudAvailable()
            ? 'Заметки хранятся в облаке Telegram и видны на всех твоих устройствах. Всё бесплатно.'
            : 'Вне Telegram заметки хранятся только в этом браузере. Всё бесплатно.'
        }
      >
        <div className="row">
          <span>Версия</span>
          <span className="row-value">
            {__BUILD__.version} · {__BUILD__.date.split('-').reverse().join('.')}
            {__BUILD__.sha && ` · ${__BUILD__.sha}`}
          </span>
        </div>
        <div className="row">
          <span>Заметок</span>
          <span className="row-value">{noteCount}</span>
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
