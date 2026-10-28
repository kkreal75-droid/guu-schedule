import { useCallback, useState } from 'react'
import { Row } from '../components/Row'
import { Section } from '../components/Section'
import { Segmented } from '../components/Segmented'
import { useGroupNames } from '../data'
import { useFavorites } from '../favorites'
import type { Extras } from '../edits'
import { botAvailable, callBot } from '../api'
import { CloseIcon } from '../icons'
import { CalendarPage } from '../more/CalendarPage'
import { AccountForm } from '../onboarding/AccountForm'
import type { Choice } from '../onboarding/Onboarding'
import type { Prefs, ThemeMode } from '../prefs'
import { groupName, isoFromDay, moscowNow, schedule } from '../schedule'
import { weekdayShort } from '../format'
import type { HiddenLesson } from '../hidden'
import { cloudAvailable } from '../storage'
import { haptic, inTelegram, openLink, telegramUser } from '../telegram'
import { useBackButton } from '../useBackButton'
import { t, useLang, type Lang } from '../i18n'
import { chooseLang } from '../language'
import { trKind, trSubject, trTeacher } from '../guu'

// «Профиль» (этап 7.8): крупный заголовок, карточка «аватар · имя · @ник · группа», «Учёба» (Учусь / Преподаю,
// строки «название — значение» и «Сохранить»), подгруппы, избранное, скрытые пары, тема, язык, календарь,
// знакомство ещё раз, о приложении.

const SOURCE_URL = 'https://guu.ru/student/schedule/'

const themeOptions = (): { value: ThemeMode; label: string }[] => [
  { value: 'light', label: t('Светлая') },
  { value: 'system', label: t('Системная') },
  { value: 'dark', label: t('Тёмная') },
]

// названия языков — каждое на своём языке, заголовок — на обоих: найти, даже если язык включился случайно
const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: 'ru', label: 'Русский' }, // i18n-ignore
  { value: 'en', label: 'English' },
]
const LANG_TITLE = 'Язык · Language' // i18n-ignore

// «по чётным неделям», «только 21.10» — на языке интерфейса
const scopeText = (h: HiddenLesson) =>
  h.scope === 'day'
    ? t('только {date}', { date: h.date ? `${h.date.slice(8, 10)}.${h.date.slice(5, 7)}` : '' })
    : { even: t('по чётным неделям'), odd: t('по нечётным неделям'), always: t('всегда') }[h.scope]

function UserCard({ who }: { who: string }) {
  const user = telegramUser()
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : t('Гость')
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
  // группа — данные ГУУ (lang="ru"), ник — как в Telegram
  const nick = user?.username ? `@${user.username}` : null
  return (
    <div className="user-card">
      {user?.photo_url ? (
        <img className="avatar" src={user.photo_url} alt="" />
      ) : (
        <div className="avatar avatar-initials">{initials.slice(0, 1)}</div>
      )}
      <div className="user-text">
        <div className="user-name">{name}</div>
        <div className="user-sub">
          {nick}
          {nick && who && ' · '}
          {who && <span lang="ru">{who}</span>}
        </div>
        {!inTelegram && <div className="user-sub">{t('Откройте через Telegram — настройки будут синхронизироваться')}</div>}
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
      title={t('Скрытые пары')}
      footer={
        list.length
          ? t('Скрытые пары не видны ни в приложении, ни в календаре на телефоне, ни в inline. Другим ничего не меняется.')
          : t('Пара не твоя (например, язык у потока в нескольких окнах)? Нажми «···» на карточке пары → «Это не моя пара».')
      }
    >
      {list.length === 0 && <Row title={<span className="hidden-empty">{t('Ничего не скрыто')}</span>} />}
      {list.map((h) => (
        <div key={h.id} className="row">
          <span className="row-label">
            <span className="row-text hidden-row-title">{trSubject(h.subject)}</span>
            <span className="row-sub">
              {[h.group !== home ? nameOf(h.group) : null, `${weekdayShort(h.weekday)} ${h.start}`, trKind(h.kind), scopeText(h)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <button type="button" className="link-btn" disabled={h.id < 0} onClick={() => (haptic(), onUnhide(h.id))}>
            {t('Вернуть#скрытая пара')}
          </button>
        </div>
      ))}
    </Section>
  )
}

export function ProfileScreen({
  prefs, onChange, onSaveChoice, onSearchGroup, noteCount, extras, hidden, onUnhide, onShowIntro,
}: Props) {
  const lang = useLang()
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
  const favorites = useFavorites()
  const nameOf = useGroupNames()
  // избранное: группы и преподаватели (имена преподавателей — из загруженного расписания)
  const favoriteName = (id: string) => (id.startsWith('t-') ? trTeacher(groupName(id)) : nameOf(id))
  // «1-курс-бакалавриат-ОФО-141.xlsx» → «141»
  const sourceVersion = schedule.source_file?.match(/-(\d+)\.xlsx$/)?.[1]
  const who = teacher ? trTeacher(prefs.teacherName ?? groupName(`t-${prefs.teacher}`)) : groupName(prefs.group)

  if (sub === 'calendar') {
    return (
      <div className="screen more">
        <h1 className="page-title page-title-gap">{t('Календарь на телефоне')}</h1>
        <CalendarPage group={prefs.group} />
      </div>
    )
  }

  return (
    <div className="screen profile">
      <h1 className="screen-title profile-title">{t('Профиль')}</h1>

      <UserCard who={who} />

      <AccountForm key={`${prefs.role}:${prefs.group}:${prefs.teacher}`} prefs={prefs} onSave={onSaveChoice} onSearch={onSearchGroup} />

      {ownSubgroups.length > 0 && (
        <Section title={t('Подгруппы')} footer={t('Например, по языку. Пары чужих подгрупп не будут показываться. Ничего не выбрано — видно всё.')}>
          {ownSubgroups.map((s) => (
            <Row key={s.id} title={s.name} check={prefs.subgroups.includes(s.id)} onClick={() => toggleSubgroup(s.id)} />
          ))}
        </Section>
      )}

      {favorites && favorites.list.length > 0 && (
        <Section title={t('Избранное')} footer={t('Вкладки над расписанием. Удерживай, чтобы переставить.')}>
          {favorites.list.map((id) => (
            <div key={id} className="row">
              <span className="row-label">
                <span className="row-text" lang={id.startsWith('t-') ? undefined : 'ru'}>
                  {favoriteName(id)}
                </span>
              </span>
              <button
                type="button"
                className="fav-remove"
                aria-label={t('Убрать из избранного')}
                onClick={() => {
                  haptic()
                  favorites.remove(id)
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
          nameOf={(g) => (g.startsWith('t-') ? t('расписание преподавателя') : nameOf(g))}
          onUnhide={onUnhide}
        />
      )}

      <section className="section">
        <h3 className="section-title">{t('Тема')}</h3>
        <Segmented label={t('Тема оформления')} value={prefs.theme} options={themeOptions()} onChange={(theme) => onChange({ theme })} />
      </section>

      <section className="section">
        <h3 className="section-title">{LANG_TITLE}</h3>
        <Segmented label={LANG_TITLE} value={lang} options={LANG_OPTIONS} onChange={(next) => (haptic(), chooseLang(next))} />
      </section>

      <div className="list profile-links">
        {!teacher && <Row icon="phone" title={t('Календарь на телефоне')} chevron onClick={() => (haptic(), setSub('calendar'), window.scrollTo(0, 0))} />}
        <Row icon="repeat" title={t('Показать знакомство ещё раз')} chevron onClick={() => (haptic(), onShowIntro())} />
      </div>

      <Section
        title={t('О приложении')}
        footer={cloudAvailable() ? t('Заметки хранятся в облаке Telegram и видны на всех твоих устройствах.') : t('Вне Telegram заметки хранятся только в этом браузере.')}
      >
        <Row
          title={t('Версия')}
          value={`${__BUILD__.version} · ${__BUILD__.date.split('-').reverse().join('.')}${__BUILD__.sha ? ` · ${__BUILD__.sha}` : ''}`}
        />
        <Row title={t('Заметок')} value={noteCount} />
        {schedule.source_file && <Row title={t('Файл ГУУ')} value={sourceVersion ? `№${sourceVersion}` : schedule.source_file} />}
        <Row title={t('Расписание на guu.ru')} out onClick={() => openLink(SOURCE_URL)} />
      </Section>
    </div>
  )
}
