// Знакомство (этап 7.1), всем один раз: выбор языка (только новым, этап 11) → истории автора → регистрация
// (новым) или «Это твоя группа?» (тем, кто уже выбирал) → тур по приложению → расписание.
// «Профиль → Показать знакомство ещё раз».
import { useEffect, useState } from 'react'
import { MB_GROUPS, type GroupInfo } from '../../shared/groups'
import type { DayLesson } from '../edits'
import { toMinutes } from '../schedule'
import { LessonCard } from '../components/LessonCard'
import { Row } from '../components/Row'
import { BOT_USERNAME } from '../config'
import { loadGroups } from '../data'
import { formatDuration } from '../format'
import { setLang, t, useLang, type Lang } from '../i18n'
import { haptic, telegramLang } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupFacts, Onboarding, Shell, type Choice } from './Onboarding'
import { Stories, StoryEmoji, type Story } from './Stories'
import type { IconName } from '../icons'
import { trTeacher } from '../guu'

// ---------- истории автора (тексты — от владельца, менять только опечатки) ----------

const author = (): Story[] => [
  {
    visual: <StoryEmoji emoji="🫡" />,
    title: t('Привет! Я Кирилл'),
    text: t('Я учусь на первом курсе ГУУ и сделал это приложение.'),
  },
  {
    visual: <StoryEmoji emoji="🗂️" />,
    title: t('Зачем это приложение'),
    text: t('Расписание ГУУ публикуется на сайте в таблицах Excel. Здесь оно собрано так, чтобы его было удобно смотреть с телефона.'),
  },
  {
    visual: <StoryEmoji emoji="🎓" />,
    title: t('Бесплатно для всех'),
    text: t('Пары, преподаватели, аудитории, корпуса и учебный график. Всё открыто сразу.'),
  },
  {
    visual: <StoryEmoji emoji="💬" />,
    title: t('Нашёл ошибку или есть идея?'),
    text: t('Напиши в поддержку прямо из приложения. Я читаю все сообщения.'),
    note: t('Проект неофициальный и не связан с администрацией ГУУ.'),
  },
]

// ---------- выбор языка (этап 11): первый экран у новых; предвыбор — по языку Telegram ----------

// нажатие на строку — сразу показывает интерфейс на этом языке, «Далее» — сохраняет выбор
function LanguagePicker({ onDone }: { onDone: (lang: Lang) => void }) {
  const lang = useLang()
  const options: { lang: Lang; label: string }[] = [
    { lang: 'ru', label: 'Русский' }, // i18n-ignore — название языка на нём самом
    { lang: 'en', label: 'English' },
  ]
  return (
    <Shell
      foot={
        <button type="button" className="button-primary" onClick={() => (haptic('light'), onDone(lang))}>
          {t('Далее')}
        </button>
      }
    >
      {/* i18n-ignore — на обоих языках */}
      <h1 className="ob-title ob-title-lang">Выбери язык</h1>
      <p className="ob-text ob-text-s">Choose language</p>
      <div className="list">
        {options.map((o) => (
          <Row key={o.lang} title={o.label} check={lang === o.lang} onClick={() => (haptic(), setLang(o.lang))} />
        ))}
      </div>
    </Shell>
  )
}

// ---------- тур ----------

const demoLesson = (start: string, end: string, subject: string, kind: string, teacher: string, room: string): DayLesson => ({
  group: 'demo',
  weekday: 0,
  start,
  end,
  subject,
  kind,
  teacher,
  room,
  weeks: [],
  pair: null,
  cancel: null,
  movedTo: null,
  movedFrom: null,
  added: false,
  notes: [],
  subgroup: null,
})

// Живой пример: вторая пара идёт, до конца 34 минуты
function TourSchedule() {
  const now = toMinutes('10:40') + 56
  return (
    <div className="tour-demo" aria-hidden="true" inert>
      {/* i18n-ignore — пример пар: данные как в файлах ГУУ (переводит карточка) */}
      <LessonCard lesson={demoLesson('09:00', '10:30', 'Теория управления', 'Лекция', 'Смирнова А.В.', 'ПА-119')} nowMinutes={now} isNext={false} pair={1} note={undefined} />
      <div className="gap">{t('Перерыв {d}', { d: formatDuration(10) })}</div>
      {/* i18n-ignore */}
      <LessonCard lesson={demoLesson('10:40', '12:10', 'Макроэкономика', 'Практика', 'Орлов Д.С.', 'У-432')} nowMinutes={now} isNext={false} pair={2} note={undefined} />
    </div>
  )
}

function FeatureList({ items }: { items: [IconName, string, string][] }) {
  return (
    <div className="list tour-list" aria-hidden="true">
      {items.map(([icon, title, sub]) => (
        <Row key={title} icon={icon} title={title} sub={sub} />
      ))}
    </div>
  )
}

const tour = (): Story[] => [
  {
    visual: <TourSchedule />,
    title: t('Всё видно сразу'),
    text: t('Какая пара идёт, где она и сколько до конца.'),
  },
  {
    visual: (
      <FeatureList
        items={[
          ['building', t('Корпуса и карты'), t('Как пройти и открыть в картах')],
          ['star', t('Рейтинг преподавателей'), t('Оценки и отзывы студентов')],
          ['door', t('Свободные аудитории'), t('Где посидеть между парами')],
          ['note', t('Заметки'), t('К паре и ко всему дню')],
          ['clipboard', t('Сессия и каникулы'), t('Экзамены и учебный график')],
        ]}
      />
    ),
    title: t('Не только пары'),
    text: t('Всё, что нужно в течение учебного дня, в одном месте.'),
  },
  {
    visual: (
      <FeatureList
        items={[
          ['calendar', t('Календарь на телефоне'), t('Пары сами появятся в Apple или Google Календаре')],
          ['chat', t('В любом чате'), t('Напиши @{bot} — и выбери день', { bot: BOT_USERNAME })],
          ['phone', t('На домашний экран'), t('Открывается одним касанием')],
        ]}
      />
    ),
    title: t('Всегда под рукой'),
    text: t('Расписание там, где тебе удобнее его смотреть.'),
  },
]

// ---------- сценарий ----------

export type Current = { role: 'student'; group: string } | { role: 'teacher'; teacher: string; name: string } | null

type Props = {
  current: Current // что уже выбрано (null — новый пользователь)
  askLang: boolean // первым экраном — «Выбери язык / Choose language»
  onChoice: (choice: Choice) => Promise<void> // сохранить выбор (настройки, бот)
  onLang: (lang: Lang) => void // язык выбран («Далее»): сохранить на устройстве, в облаке и в боте
  onFinish: () => Promise<void> // знакомство пройдено — открыть расписание
}

type Stage = 'lang' | 'author' | 'confirm' | 'register' | 'tour' | 'finish'

export function IntroFlow({ current, askLang, onChoice, onLang, onFinish }: Props) {
  useLang()
  // сначала язык — новым, тем, кто язык ещё не выбирал, и при повторном знакомстве («Показать знакомство ещё раз»,
  // сброс онбординга); новым он предвыбран по Telegram, остальным — текущий язык интерфейса
  const [stage, setStage] = useState<Stage>(askLang ? 'lang' : 'author')
  useEffect(() => {
    if (askLang && !current) setLang(telegramLang())
  }, [askLang, current])
  const [chosen, setChosen] = useState(current)
  const [groupName, setGroupName] = useState<string | null>(null)
  const [group, setGroup] = useState<GroupInfo | null>(null)
  const [error, setError] = useState(false)

  // полное имя группы («МБ(МП) 1-1», а не «1-1») и что это за группа: форма, институт, программа
  const groupId = chosen?.role === 'student' ? chosen.group : null
  useEffect(() => {
    if (!groupId) return
    setGroupName(MB_GROUPS.find((g) => g.id === groupId)?.name ?? null)
    loadGroups().then((index) => {
      const found = index.groups.find((g) => g.id === groupId) ?? null
      setGroupName(found?.name ?? groupId)
      setGroup(found)
    }, () => {})
  }, [groupId])

  const finish = async () => {
    setStage('finish')
    try {
      await onFinish()
    } catch {
      setError(true)
    }
  }

  const confirmBack = () => (haptic(), setStage('author'))
  useBackButton(stage === 'confirm' ? confirmBack : null)

  if (stage === 'lang') {
    return <LanguagePicker onDone={(lang) => (onLang(lang), setStage('author'))} />
  }

  if (stage === 'author') {
    return (
      <Stories
        key="author"
        stories={author()}
        onBack={askLang ? () => setStage('lang') : undefined}
        onDone={() => setStage(chosen ? 'confirm' : 'register')}
      />
    )
  }

  if (stage === 'confirm' && chosen) {
    const student = chosen.role === 'student'
    return (
      <Shell
        foot={
          <>
            <button type="button" className="button-primary" onClick={() => (haptic('light'), setStage('tour'))}>
              {student ? t('Да, это моя группа') : t('Да, всё верно')}
            </button>
            <button type="button" className="link-btn" onClick={() => (haptic(), setStage('register'))}>
              {student ? t('Выбрать другую') : t('Сменить')}
            </button>
          </>
        }
      >
        <p className="ob-overline">{student ? t('Твоя группа') : t('Ваше расписание')}</p>
        <h1 className="ob-name" lang={student ? 'ru' : undefined}>
          {student ? (groupName ?? t('Загружаю…')) : trTeacher(chosen.name)}
        </h1>
        {student && group && <GroupFacts group={group} />}
        <p className="ob-note ob-note-2">{student ? t('Её расписание откроется при запуске.') : t('Ваше расписание откроется при запуске.')}</p>
      </Shell>
    )
  }

  if (stage === 'register') {
    return (
      <Onboarding
        onCancel={() => setStage(chosen ? 'confirm' : 'author')}
        onDone={async (choice) => {
          await onChoice(choice)
          setChosen(choice.role === 'student' ? { role: 'student', group: choice.group } : choice)
          setStage('tour')
        }}
      />
    )
  }

  if (stage === 'tour') {
    return (
      <Stories
        key="tour"
        stories={tour()}
        doneLabel={t('Начать')}
        onSkip={finish}
        onDone={finish}
        onBack={() => setStage(chosen ? 'confirm' : 'register')}
      />
    )
  }

  return (
    <Shell center>
      {error ? (
        <>
          <p className="ob-text">{t('Не получилось загрузить расписание. Проверь интернет.')}</p>
          <button type="button" className="link-btn" onClick={finish}>
            {t('Повторить')}
          </button>
        </>
      ) : (
        <p className="ob-text">{t('Открываю расписание…')}</p>
      )}
    </Shell>
  )
}
