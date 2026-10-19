import { Section } from '../components/Section'
import { BOT_USERNAME } from '../config'
import { haptic, openTelegramLink } from '../telegram'

export function GroupBotPage() {
  return (
    <div className="page-body">
      <p className="lead">Бот может сам присылать расписание в беседу вашей группы:</p>
      <ul className="bullets">
        <li>каждое учебное утро — пары на день;</li>
        <li>в субботу вечером — неделю вперёд;</li>
        <li>если расписание поменялось — что именно.</li>
      </ul>

      <button
        type="button"
        className="button-primary"
        onClick={() => {
          haptic('light')
          openTelegramLink(`https://t.me/${BOT_USERNAME}?startgroup=setup`)
        }}
      >
        Добавить в беседу
      </button>

      <Section title="Как настроить">
        <div className="row row-text">1. Нажмите «Добавить в беседу» и выберите беседу группы.</div>
        <div className="row row-text">
          2. Админ беседы отправляет /setup и выбирает группу и время: 7:00, 7:30 или 8:00.
        </div>
      </Section>

      <p className="section-footer">
        В беседе работают /today и /tomorrow — пары на сегодня и завтра, /off выключает автосообщения.
      </p>
    </div>
  )
}
