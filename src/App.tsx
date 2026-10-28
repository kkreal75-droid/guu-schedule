import { useCallback, useEffect, useMemo, useState } from 'react'
import { AddFavoriteSheet } from './components/AddFavoriteSheet'
import { FavoritesBar } from './components/FavoritesBar'
import { FavoritesContext, type Favorites } from './favorites'
import { loadStatus, loadTeachers } from './data'
import type { Choice } from './onboarding/Onboarding'
import { isTeacherKey } from '../shared/schedule-core'
import { NoticeBar } from './components/NoticeBar'
import { botAvailable, botError, callBot, saveFavorites } from './api'
import type { DayLesson, Extras } from './edits'
import { cachedHidden, hideLesson, rememberHidden, unhideLesson, type HiddenLesson, type HideScope } from './hidden'
import { formatUpdated } from './format'
import { useNotes } from './notes'
import { usePrefs } from './prefs'
import { TabBar, type Tab } from './components/TabBar'
import { MoreScreen, type MoreRequest } from './screens/MoreScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScheduleScreen, initialCursor, type Cursor } from './screens/ScheduleScreen'
import { fromCache, getTimetable, groupName, homeOf, schedule } from './schedule'
import { confirmAction, haptic, showAlert, type CheckIn } from './telegram'
import { trTeacher } from './guu'
import { useTheme } from './theme'
import { t } from './i18n'

const STALE_MS = 6 * 3_600_000

export type { Tab }

// status — ответ бота при открытии (админ ли); null — вне Telegram или бот недоступен.
// edits — ручные правки расписания из админ-панели.
// onChangeProfile — выбор группы в онбординге (search — сразу поиск); onSaveChoice — «Профиль → Параметры
// аккаунта → Сохранить»; onReload — перегрузить расписание
// после смены избранного (см. main.tsx); startTab — какую вкладку открыть после перезагрузки
type Props = {
  status: CheckIn | null
  extras: Extras
  startTab?: Tab
  onReload: (tab: Tab) => Promise<void>
  onChangeProfile: (search?: boolean) => void
  onSaveChoice: (choice: Choice) => Promise<void>
  onShowIntro: () => void // «Показать знакомство ещё раз»
}

// Мини-приложение открыли кнопкой из рассылки бота: «?open=session» — сразу экран сессии
// (параметр убираем из адреса после первого показа, чтобы не открывать его при каждой перерисовке)
function openedFrom(): MoreRequest | null {
  return new URLSearchParams(window.location.search).get('open') === 'session' ? { item: 'session' } : null
}
function forgetOpened() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('open')) return
  url.searchParams.delete('open')
  window.history.replaceState(window.history.state, '', url)
}

// добавили в избранное через «+» — после перезагрузки расписания сразу показать добавленное
let viewAfterReload: string | null = null

export default function App({ status, extras: initialExtras, startTab, onReload, onChangeProfile, onSaveChoice, onShowIntro }: Props) {
  const [prefs, updatePrefs] = usePrefs()
  // правки и подгруппы; староста меняет их — обновляем сразу, без перезапуска
  const [extras, setExtras] = useState(initialExtras)
  const onGroupExtras = useCallback((group: string, next: Extras) => {
    setExtras((cur) => ({
      edits: [...cur.edits.filter((e) => e.group !== group), ...next.edits],
      subgroups: [...cur.subgroups.filter((s) => s.group !== group), ...next.subgroups],
      tags: [...cur.tags.filter((t) => t.group !== group), ...next.tags],
      hidden: next.hidden ? [...(cur.hidden ?? []).filter((h) => h.group !== group), ...next.hidden] : cur.hidden,
    }))
  }, [])

  // «Это не моя пара»: свои скрытые пары (бот + копия на устройстве) поверх скрытых для всей группы
  const [myHidden, setMyHidden] = useState<HiddenLesson[]>(cachedHidden)
  const shownExtras = useMemo(
    () => (myHidden.length ? { ...extras, hidden: [...(extras.hidden ?? []), ...myHidden] } : extras),
    [extras, myHidden],
  )
  const saveHidden = (list: HiddenLesson[]) => {
    setMyHidden(list)
    rememberHidden(list)
  }
  const hideError = (err: unknown) => showAlert(botError(err))
  // скрываем сразу, бот подтверждает; не вышло — возвращаем как было
  const onHide = useCallback(async (lesson: DayLesson, date: string, scope: HideScope): Promise<number | null> => {
    const temp: HiddenLesson = {
      id: -Date.now(),
      group: lesson.group,
      weekday: lesson.weekday,
      start: lesson.start,
      subject: lesson.subject,
      kind: lesson.kind,
      scope,
      date: scope === 'day' ? date : null,
    }
    setMyHidden((cur) => [...cur, temp])
    try {
      const res = await hideLesson({ group: lesson.group, date, start: lesson.start, subject: lesson.subject, kind: lesson.kind, scope })
      saveHidden(res.hidden)
      return res.id
    } catch (err) {
      setMyHidden((cur) => cur.filter((h) => h.id !== temp.id))
      hideError(err)
      return null
    }
  }, [])
  const onUnhide = async (id: number) => {
    const before = myHidden
    setMyHidden(before.filter((h) => h.id !== id))
    try {
      saveHidden((await unhideLesson(id)).hidden)
    } catch (err) {
      setMyHidden(before)
      hideError(err)
    }
  }
  const { notes, setNote } = useNotes()
  useTheme(prefs.theme)

  // своё расписание: преподавателю — его пары, студенту — его группа
  const home = homeOf(prefs)

  // У преподавателей в ленте (своё ФИО, избранные) пары — с группами; правки этих групп (отмены, переносы,
  // добавленные старостой пары) относятся и к ним — подгружаем их (своих групп правки уже пришли в /seen)
  useEffect(() => {
    const tt = getTimetable()
    const known = new Set(tt.schedule.groups)
    const groups = [
      ...new Set(tt.schedule.lessons.filter((l) => isTeacherKey(l.group)).flatMap((l) => l.audience?.map((a) => a.id) ?? [])),
    ].filter((g) => !known.has(g))
    if (!groups.length || !botAvailable()) return
    callBot<Extras>('/extras', { groups: groups.slice(0, 60) }).then(
      (x) =>
        setExtras((cur) => {
          const fresh = new Set(groups)
          return {
            edits: [...cur.edits.filter((e) => !fresh.has(e.group)), ...x.edits],
            subgroups: [...cur.subgroups.filter((s) => !fresh.has(s.group)), ...x.subgroups],
            tags: [...cur.tags.filter((t) => !fresh.has(t.group)), ...x.tags],
            hidden: cur.hidden,
          }
        }),
      () => {},
    )
  }, [])
  const [tab, setTab] = useState<Tab>(() => startTab ?? (openedFrom() ? 'more' : 'schedule'))
  // группа, выбранная переключателем на экране расписания; null — своя
  const [viewGroup, setViewGroup] = useState<string | null>(() => {
    const id = viewAfterReload
    viewAfterReload = null
    return id
  })
  const shownGroup = viewGroup && schedule.groups.includes(viewGroup) ? viewGroup : home
  const [cursor, setCursor] = useState<Cursor>(initialCursor)

  // избранное поменялось — расписание перегрузим, когда человек вернётся на вкладку «Расписание»
  const [favoritesChanged, setFavoritesChanged] = useState(false)
  const switchTab = (next: Tab) => {
    if (next === tab) return
    haptic()
    if (next === 'schedule' && favoritesChanged) return void onReload('schedule')
    setMoreRequest(null)
    setTab(next)
    window.scrollTo(0, 0)
  }

  // «Обновлено» — последняя УСПЕШНАЯ проверка guu.ru (data/status.json), а не последняя смена пар; файла нет —
  // как раньше, время данных. Старше 6 часов — мелкая пометка «данные могут быть устаревшими».
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  useEffect(() => {
    loadStatus().then((s) => setCheckedAt(typeof s.checked_at === 'string' ? s.checked_at : null), () => {})
  }, [])
  const stamp = checkedAt ?? schedule.updated_at ?? null
  const updatedAt = stamp ? formatUpdated(stamp) : null
  const outdated = stamp !== null && Date.now() - Date.parse(stamp) > STALE_MS

  // нажатие на преподавателя в паре — его карточка в «Другое → Рейтинг преподавателей»; «Назад» — сюда
  const [moreRequest, setMoreRequest] = useState<MoreRequest | null>(() => (startTab ? null : openedFrom()))
  useEffect(forgetOpened, [])
  const openTeacher = useCallback(async (name: string) => {
    haptic()
    const list = await loadTeachers().then((d) => d.teachers, () => null)
    const teacher = list?.find((t) => t.name === name)
    if (!teacher) return showAlert(list ? t('{name} нет в списке преподавателей ГУУ.', { name }) : t('Нет связи. Попробуй ещё раз.'))
    setMoreRequest({ item: 'teachers', teacher })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  // нажатие на аудиторию в паре — карточка корпуса в «Другое → Корпуса ГУУ»; «Назад» — сюда
  const openRoom = useCallback((room: string) => {
    haptic()
    setMoreRequest({ item: 'places', room })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  // нажатие на группу у пары преподавателя — расписание этой группы в «Другое → Расписание группы»
  const openGroup = useCallback((id: string) => {
    haptic()
    setMoreRequest({ item: 'group-schedule', group: id })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  // «Все мероприятия» в блоке проектного обучения — «Сервисы → Мероприятия ГУУ»; «Назад» — сюда
  const openEvents = useCallback(() => {
    setMoreRequest({ item: 'events' })
    setTab('more')
    window.scrollTo(0, 0)
  }, [])
  const backToSchedule = useCallback(() => {
    setMoreRequest(null)
    setTab('schedule')
    window.scrollTo(0, 0)
  }, [])

  // Избранное (этап 12): группы и преподаватели по порядку ленты; сохраняем в настройках (устройство + облако)
  // и у бота. Добавили на других вкладках — расписание перегрузим, когда вернутся на «Расписание»
  const setFavorites = (list: string[]) => {
    const at = Date.now()
    updatePrefs({ favorites: list, favAt: at })
    saveFavorites(list, at).catch((err) => console.warn('Не удалось сохранить избранное у бота', err))
  }
  const favorites: Favorites = {
    home,
    list: prefs.favorites.filter((id) => id !== home),
    has: (id) => id === home || prefs.favorites.includes(id),
    add: (id) => {
      if (id === home || prefs.favorites.includes(id)) return
      setFavorites([...prefs.favorites, id])
      setFavoritesChanged(true)
    },
    remove: (id) => {
      setFavorites(prefs.favorites.filter((f) => f !== id))
      if (viewGroup === id) setViewGroup(null)
    },
    reorder: setFavorites,
  }
  // лента: только то, что загрузилось (группы, которой больше нет в расписании ГУУ, не покажем)
  const ribbon = favorites.list.filter((id) => schedule.groups.includes(id))
  const chipLabel = (id: string) => (isTeacherKey(id) ? trTeacher(groupName(id)) : groupName(id))
  const removeFromRibbon = async (id: string) => {
    if (!(await confirmAction(t('Убрать «{name}» из избранного?', { name: chipLabel(id) })))) return
    haptic('light')
    favorites.remove(id)
  }

  // «+» в ленте: найти группу или преподавателя, добавить в избранное и перегрузить расписание с ним
  const [adding, setAdding] = useState(false)
  const closeAdding = useCallback(() => setAdding(false), [])
  const addFromRibbon = (id: string) => {
    setAdding(false)
    if (favorites.has(id)) return
    setFavorites([...prefs.favorites, id])
    viewAfterReload = id
    void onReload('schedule')
  }

  // «Обновлено 25 октября в 10:32» — на расписании под «Выходным» или в конце дня, в других разделах — внизу
  const updatedLine = updatedAt && (
    <>
      {t('Обновлено {at}', { at: updatedAt })}
      {fromCache && ` · ${t('нет сети, сохранённая копия')}`}
      {outdated && !fromCache && ` · ${t('данные могут быть устаревшими')}`}
    </>
  )

  return (
    <FavoritesContext.Provider value={favorites}>
    <div className="app">
      {tab === 'schedule' && status?.notice && <NoticeBar notice={status.notice} />}
      {tab === 'schedule' ? (
        <ScheduleScreen
          extras={shownExtras}
          mine={shownGroup === prefs.group ? prefs.subgroups : null}
          group={shownGroup}
          bar={
            <FavoritesBar
              value={shownGroup}
              home={home}
              items={ribbon}
              label={chipLabel}
              onChange={(id) => setViewGroup(id === home ? null : id)}
              onAdd={() => (haptic(), setAdding(true))}
              onReorder={(list) => favorites.reorder([...list, ...prefs.favorites.filter((f) => !list.includes(f))])}
              onRemove={removeFromRibbon}
            />
          }
          onGroup={openGroup}
          onTeacher={isTeacherKey(shownGroup) ? undefined : openTeacher}
          onRoom={openRoom}
          onEvents={openEvents}
          updated={updatedLine}
          cursor={cursor}
          onCursorChange={setCursor}
          notes={notes}
          onSaveNote={setNote}
          onHide={botAvailable() ? onHide : undefined}
          onUnhide={onUnhide}
        />
      ) : tab === 'more' ? (
        <MoreScreen
          admin={Boolean(status?.admin)}
          group={shownGroup}
          teacherMode={prefs.role === 'teacher'}
          extras={extras}
          starosta={status?.me?.starosta ?? null}
          onGroupExtras={onGroupExtras}
          channel={status?.channel}
          request={moreRequest}
          onRequestBack={backToSchedule}
        />
      ) : (
        <ProfileScreen
          noteCount={Object.keys(notes).length}
          prefs={prefs}
          extras={extras}
          hidden={myHidden}
          onUnhide={onUnhide}
          onChange={(patch) => {
            updatePrefs(patch)
            if (patch.favorites) setFavoritesChanged(true)
          }}
          onSearchGroup={() => onChangeProfile(true)}
          onSaveChoice={onSaveChoice}
          onShowIntro={onShowIntro}
        />
      )}

      {adding && <AddFavoriteSheet exclude={[home, ...prefs.favorites]} onPick={addFromRibbon} onClose={closeAdding} />}

      {tab !== 'schedule' && updatedLine && <p className="updated">{updatedLine}</p>}

      <TabBar tab={tab} onTab={switchTab} />
    </div>
    </FavoritesContext.Provider>
  )
}
