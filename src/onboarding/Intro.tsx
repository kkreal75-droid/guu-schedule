// Знакомство (этап 7.1), всем один раз: выбор языка (только новым, этап 11) → истории автора → регистрация
// (новым) или «Это твоя группа?» (тем, кто уже выбирал) → тур по приложению → расписание.
// «Профиль → Показать знакомство ещё раз».
import { useEffect, useState } from 'react'
import { MB_GROUPS } from '../../shared/groups'
import type { DayLesson } from '../edits'
import { dayFromIso, moscowNow, toMinutes } from '../schedule'
import { LessonCard } from '../components/LessonCard'
import { WeekCard } from '../components/WeekCard'
import { BOT_USERNAME } from '../config'
import { loadGroups } from '../data'
import { setLang, t, useLang, type Lang } from '../i18n'
import { CheckIcon } from '../icons'
import { haptic, telegramLang } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupCard, Onboarding, Shell, type Choice } from './Onboarding'
import { EmojiTile, Stories, type Story } from './Stories'
import { trTeacher } from '../guu'

// ---------- истории автора (тексты — от владельца, менять только опечатки; английские — тоже от него) ----------

const author = (): Story[] => [
  {
    visual: <EmojiTile emoji="👋" />,
    overline: t('пара слов перед началом'),
    title: t('Привет! Я Кирилл'),
    text: <p>{t('Студент 1 курса ГУУ и автор этого приложения.')}</p>,
  },
  {
    visual: <EmojiTile emoji="💸" />,
    overline: t('почему это появилось'),
    title: t('Расписание не должно стоить денег'),
    text: <p>{t('Мне надоело платить за то, что университет и так публикует бесплатно. Поэтому я сделал своё — удобное и бесплатное.')}</p>,
  },
  {
    visual: <EmojiTile emoji="🎁" />,
    overline: t('и так будет дальше'),
    title: t('Всё бесплатно. Без подписок и замков'),
    text: <p>{t('Все пары, преподаватели, аудитории, корпуса, календарь — для всех и сразу.')}</p>,
  },
  {
    visual: <EmojiTile emoji="🤝" />,
    overline: t('сделано студентами'),
    title: t('Нашёл ошибку или есть идея?'),
    text: <p>{t('Пиши в поддержку прямо из приложения — я читаю всё.')}</p>,
    note: t('Проект неофициальный и не связан с администрацией ГУУ.'),
  },
]

// ---------- выбор языка (этап 11): первый экран у новых; предвыбор — по языку Telegram ----------

// нажатие на карточку — сразу показывает интерфейс на этом языке, «Далее» — сохраняет выбор
function LanguagePicker({ onDone }: { onDone: (lang: Lang) => void }) {
  const lang = useLang()
  const options: { lang: Lang; flag: string; label: string }[] = [
    { lang: 'ru', flag: '🇷🇺', label: 'Русский' }, // i18n-ignore — название языка на нём самом
    { lang: 'en', flag: '🇬🇧', label: 'English' },
  ]
  return (
    <Shell
      foot={
        <button type="button" className="button-primary" onClick={() => (haptic('light'), onDone(lang))}>
          {t('Далее')}
        </button>
      }
    >
      <div className="ob-step ob-lang">
        <EmojiTile emoji="🌐" />
        <h1 className="ob-title">Выбери язык / Choose language</h1>{/* i18n-ignore — на обоих языках */}
        <div className="ob-cards">
          {options.map((o) => (
            <button
              key={o.lang}
              type="button"
              className="ob-card ob-card-role ob-card-lang"
              aria-pressed={lang === o.lang}
              onClick={() => (haptic(), setLang(o.lang))}
            >
              <span className="ob-card-emoji">{o.flag}</span>
              <span className="ob-card-text">
                <span className="ob-card-label">{o.label}</span>
              </span>
              {lang === o.lang && <CheckIcon className="ob-card-chevron ob-card-check" />}
            </button>
          ))}
        </div>
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

// Живой пример: неделя — текущая, вторая пара идёт, до конца 34 минуты
function TourSchedule() {
  const { day } = moscowNow()
  const start = dayFromIso('2026-08-31')
  const week = Math.max(1, Math.floor((day - start) / 7) + 1)
  const monday = start + (week - 1) * 7
  const now = toMinutes('10:40') + 56
  return (
    <div className="tour-demo" aria-hidden="true" inert>
      <WeekCard week={week} day={day} monday={monday} />
      {/* i18n-ignore — пример пар: данные как в файлах ГУУ (переводит карточка) */}
      <LessonCard lesson={demoLesson('09:00', '10:30', 'Теория управления', 'Лекция', 'Смирнова А.В.', 'ПА-119')} nowMinutes={now} isNext={false} pair={1} note={undefined} />
      {/* i18n-ignore */}
      <LessonCard lesson={demoLesson('10:40', '12:10', 'Макроэкономика', 'Практика', 'Орлов Д.С.', 'У-432')} nowMinutes={now} isNext={false} pair={2} note={undefined} />
    </div>
  )
}

function FeatureList({ items }: { items: [string, string, string][] }) {
  return (
    <div className="tour-list" aria-hidden="true">
      {items.map(([emoji, title, sub]) => (
        <div key={title} className="tour-item">
          <span className="tour-item-emoji">{emoji}</span>
          <span className="tour-item-text">
            <span className="tour-item-title">{title}</span>
            <span className="tour-item-sub">{sub}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const tour = (): Story[] => [
  {
    visual: <TourSchedule />,
    overline: t('главное'),
    title: t('Расписание, которое видно с одного взгляда'),
    text: <p>{t('Сразу понятно, какая пара идёт и сколько осталось до конца. Дни меняются свайпом.')}</p>,
  },
  {
    visual: (
      <FeatureList
        items={[
          ['🏛', t('Корпуса и карты'), t('Как пройти и открыть в картах')],
          ['⭐', t('Рейтинг преподавателей'), t('Оценки и отзывы студентов')],
          ['🚪', t('Свободные аудитории'), t('Где посидеть между парами')],
          ['📝', t('Заметки'), t('К паре и ко всему дню')],
          ['📚', t('Сессия и каникулы'), t('Экзамены и учебный график')],
        ]}
      />
    ),
    overline: t('ещё в приложении'),
    title: t('Не только пары'),
    text: <p>{t('Всё, что нужно в течение учебного дня, — в одном месте.')}</p>,
  },
  {
    visual: (
      <FeatureList
        items={[
          ['📅', t('Календарь на телефоне'), t('Пары сами появятся в Apple или Google Календаре')],
          ['💬', t('В любом чате'), t('Напиши @{bot} — и выбери день', { bot: BOT_USERNAME })],
          ['📲', t('На домашний экран'), t('Открывается одним касанием')],
        ]}
      />
    ),
    overline: t('удобно'),
    title: t('Всегда под рукой'),
    text: <p>{t('Расписание там, где тебе удобнее его смотреть.')}</p>,
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
  const [error, setError] = useState(false)

  // полное имя группы («МБ(МП) 1-1», а не «1-1»)
  const groupId = chosen?.role === 'student' ? chosen.group : null
  useEffect(() => {
    if (!groupId) return
    setGroupName(MB_GROUPS.find((g) => g.id === groupId)?.name ?? null)
    loadGroups().then((index) => setGroupName(index.groups.find((g) => g.id === groupId)?.name ?? groupId), () => {})
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
              {t('Да, всё верно')}
            </button>
            <button type="button" className="button-secondary" onClick={() => (haptic(), setStage('register'))}>
              {t('Сменить')}
            </button>
          </>
        }
      >
        <div className="ob-hero">
          <p className="ob-overline">{student ? t('твоя группа') : t('ваше расписание')}</p>
          <GroupCard
            emoji={student ? '🎓' : '🧑‍🏫'}
            name={student ? (groupName ?? t('Загружаю…')) : trTeacher(chosen.name)}
            text={student ? t('Это твоя группа? Её расписание откроется при запуске.') : t('Это вы? Ваше расписание откроется при запуске.')}
          />
        </div>
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
    <Shell>
      <div className="ob-hero">
        <EmojiTile emoji="🎓" />
        {error ? (
          <>
            <p className="ob-text">{t('Не получилось загрузить расписание. Проверь интернет.')}</p>
            <button type="button" className="button-secondary" onClick={finish}>
              {t('Повторить')}
            </button>
          </>
        ) : (
          <p className="ob-text">{t('Открываю расписание…')}</p>
        )}
      </div>
    </Shell>
  )
}
