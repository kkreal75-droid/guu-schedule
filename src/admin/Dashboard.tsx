import { Section } from '../components/Section'
import { adminApi, adminError } from './api'
import { BarChart, Loading, Stat, useLoad } from './common'

export function Dashboard() {
  const { data, error } = useLoad(adminApi.dashboard)
  if (!data) return <Loading error={error ? adminError(error) : null} />
  const { users, chats, calendar, board } = data
  const noGroup = users.total - users.g11 - users.g12 - (users.other ?? 0) - (users.teachers ?? 0)

  return (
    <div className="page-body">
      <Section title="Пользователи">
        <div className="stats">
          <Stat label="всего" value={users.total} />
          <Stat label="за сутки" value={users.day} />
          <Stat label="за 7 дней" value={users.week} />
          <Stat label="за 30 дней" value={users.month} />
        </div>
      </Section>

      <Section title="Новые по дням — 30 дней">
        <BarChart
          values={data.new_by_day.map((d) => d.n)}
          labels={data.new_by_day.map((d) => `${d.day.slice(8)}.${d.day.slice(5, 7)}`)}
          every={7}
        />
      </Section>

      <Section title="Открытия по часам (МСК) — 30 дней">
        <BarChart values={data.opens_by_hour} labels={data.opens_by_hour.map((_, h) => String(h))} every={3} />
      </Section>

      <Section title="По группам">
        <div className="stats">
          <Stat label="1-1" value={users.g11} />
          <Stat label="1-2" value={users.g12} />
          <Stat label="другие группы" value={users.other ?? 0} />
          <Stat label="преподаватели" value={users.teachers ?? 0} />
          <Stat label="не выбрана" value={noGroup} />
          <Stat label="открытий" value={users.opens} />
        </div>
      </Section>

      <Section title="Беседы и календарь">
        <div className="stats">
          <Stat label="бесед" value={chats.total} hint={`1-1: ${chats.g11} · 1-2: ${chats.g12}`} />
          <Stat label="со сводками" value={chats.digests} />
          <Stat label="подписок на календарь" value={calendar.total} />
          <Stat label="обновлялись за сутки" value={calendar.active} />
        </div>
      </Section>

      <Section title="Чат">
        <div className="stats">
          <Stat label="участников" value={board.members} />
          <Stat label="сообщений" value={board.messages_day} hint={`за 7 дней: ${board.messages_week}`} />
          <Stat label="жалоб ждут" value={board.reports} />
        </div>
      </Section>

      <p className="section-footer">
        Забанены: {users.banned} · заблокировали бота: {users.blocked}. «За сутки» — кто открывал приложение или писал боту.
      </p>
    </div>
  )
}
