import { BottomAction } from '../components/BottomAction'
import { Section } from '../components/Section'
import { BOT_USERNAME } from '../config'
import { haptic, openTelegramLink } from '../telegram'
import { t } from '../i18n'

// «Сервисы → Бот в беседе группы»: что бот присылает, шаги настройки красными цифрами, кнопка внизу
export function GroupBotPage() {
  const step = (n: number, title: string, sub?: string) => (
    <div className="row">
      <span className="row-emoji step-no">{n}</span>
      <span className="row-label">
        <span className="row-text">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
    </div>
  )
  return (
    <div className="page-fill">
      <p className="page-lead page-lead-tight">{t('Бот сам присылает расписание в чат группы:')}</p>
      <ul className="bullets">
        <li>{t('каждое учебное утро: пары на день')}</li>
        <li>{t('в субботу вечером: неделю вперёд')}</li>
        <li>{t('если расписание поменялось: что именно')}</li>
      </ul>

      <Section title={t('Как настроить')} footer={t('/today и /tomorrow: пары на сегодня и завтра. /off выключает автосообщения.')}>
        {step(1, t('Добавь бота в беседу группы'))}
        {step(2, t('Админ отправляет /setup'), t('и выбирает группу и время: 7:00, 7:30 или 8:00'))}
        {step(3, t('Выбери язык сообщений'), t('кнопками в конце настройки'))}
      </Section>

      <BottomAction>
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            haptic('light')
            openTelegramLink(`https://t.me/${BOT_USERNAME}?startgroup=setup`)
          }}
        >
          {t('Добавить в беседу')}
        </button>
      </BottomAction>
    </div>
  )
}
