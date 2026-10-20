// Знакомство (этап 7.1), всем один раз: истории автора → регистрация (новым) или «Это твоя группа?»
// (тем, кто уже выбирал) → тур по приложению → расписание. «Профиль → Показать знакомство ещё раз».
import { useEffect, useState } from 'react'
import { MB_GROUPS } from '../../shared/groups'
import type { DayLesson } from '../edits'
import { dayFromIso, moscowNow, toMinutes } from '../schedule'
import { LessonCard } from '../components/LessonCard'
import { WeekCard } from '../components/WeekCard'
import { BOT_USERNAME } from '../config'
import { loadGroups } from '../data'
import { haptic } from '../telegram'
import { useBackButton } from '../useBackButton'
import { GroupCard, Onboarding, Shell, type Choice } from './Onboarding'
import { EmojiTile, Stories, type Story } from './Stories'

// ---------- истории автора (тексты — от владельца, менять только опечатки) ----------

const AUTHOR: Story[] = [
  {
    visual: <EmojiTile emoji="👋" />,
    overline: 'пара слов перед началом',
    title: 'Привет! Я Кирилл',
    text: <p>Студент 1 курса ГУУ и автор этого приложения.</p>,
  },
  {
    visual: <EmojiTile emoji="💸" />,
    overline: 'почему это появилось',
    title: 'Расписание не должно стоить денег',
    text: (
      <p>
        Мне надоело платить за то, что университет и так публикует бесплатно. Поэтому я сделал своё — удобное и
        бесплатное.
      </p>
    ),
  },
  {
    visual: <EmojiTile emoji="🎁" />,
    overline: 'и так будет дальше',
    title: 'Всё бесплатно. Без подписок и замков',
    text: <p>Все пары, преподаватели, аудитории, корпуса, календарь — для всех и сразу.</p>,
  },
  {
    visual: <EmojiTile emoji="🤝" />,
    overline: 'сделано студентами',
    title: 'Нашёл ошибку или есть идея?',
    text: <p>Пиши в поддержку прямо из приложения — я читаю всё.</p>,
    note: 'Проект неофициальный и не связан с администрацией ГУУ.',
  },
]

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
      <LessonCard lesson={demoLesson('09:00', '10:30', 'Теория управления', 'Лекция', 'Смирнова А.В.', 'ПА-119')} nowMinutes={now} isNext={false} pair={1} note={undefined} />
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

const TOUR: Story[] = [
  {
    visual: <TourSchedule />,
    overline: 'главное',
    title: 'Расписание, которое видно с одного взгляда',
    text: <p>Сразу понятно, какая пара идёт и сколько осталось до конца. Дни меняются свайпом.</p>,
  },
  {
    visual: (
      <FeatureList
        items={[
          ['🏛', 'Корпуса и карты', 'Как пройти и открыть в картах'],
          ['⭐', 'Рейтинг преподавателей', 'Оценки и отзывы студентов'],
          ['🚪', 'Свободные аудитории', 'Где посидеть между парами'],
          ['📝', 'Заметки', 'К паре и ко всему дню'],
          ['🤫', 'Подслушано', 'Анонимный чат ГУУ'],
        ]}
      />
    ),
    overline: 'ещё в приложении',
    title: 'Не только пары',
    text: <p>Всё, что нужно в течение учебного дня, — в одном месте.</p>,
  },
  {
    visual: (
      <FeatureList
        items={[
          ['📅', 'Календарь на телефоне', 'Пары сами появятся в Apple или Google Календаре'],
          ['💬', 'В любом чате', `Напиши @${BOT_USERNAME} — и выбери день`],
          ['📲', 'На домашний экран', 'Открывается одним касанием'],
        ]}
      />
    ),
    overline: 'удобно',
    title: 'Всегда под рукой',
    text: <p>Расписание там, где тебе удобнее его смотреть.</p>,
  },
]

// ---------- сценарий ----------

export type Current = { role: 'student'; group: string } | { role: 'teacher'; teacher: string; name: string } | null

type Props = {
  current: Current // что уже выбрано (null — новый пользователь)
  onChoice: (choice: Choice) => Promise<void> // сохранить выбор (настройки, бот)
  onFinish: () => Promise<void> // знакомство пройдено — открыть расписание
}

type Stage = 'author' | 'confirm' | 'register' | 'tour' | 'finish'

export function IntroFlow({ current, onChoice, onFinish }: Props) {
  const [stage, setStage] = useState<Stage>('author')
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

  if (stage === 'author') {
    return <Stories key="author" stories={AUTHOR} onDone={() => setStage(chosen ? 'confirm' : 'register')} />
  }

  if (stage === 'confirm' && chosen) {
    const student = chosen.role === 'student'
    return (
      <Shell
        foot={
          <>
            <button type="button" className="button-primary" onClick={() => (haptic('light'), setStage('tour'))}>
              Да, всё верно
            </button>
            <button type="button" className="button-secondary" onClick={() => (haptic(), setStage('register'))}>
              Сменить
            </button>
          </>
        }
      >
        <div className="ob-hero">
          <p className="ob-overline">{student ? 'твоя группа' : 'ваше расписание'}</p>
          <GroupCard
            emoji={student ? '🎓' : '🧑‍🏫'}
            name={student ? (groupName ?? 'Загружаю…') : chosen.name}
            text={student ? 'Это твоя группа? Её расписание откроется при запуске.' : 'Это вы? Ваше расписание откроется при запуске.'}
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
        stories={TOUR}
        doneLabel="Начать"
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
            <p className="ob-text">Не получилось загрузить расписание. Проверь интернет.</p>
            <button type="button" className="button-secondary" onClick={finish}>
              Повторить
            </button>
          </>
        ) : (
          <p className="ob-text">Открываю расписание…</p>
        )}
      </div>
    </Shell>
  )
}
