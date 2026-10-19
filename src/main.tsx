import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installTelegramMock } from './dev/telegram-mock'
import './index.css'
import { loadSchedule } from './schedule'
import { checkIn, initTelegram } from './telegram'

if (import.meta.env.DEV) installTelegramMock()
initTelegram()
// параллельно с расписанием: визит для статистики и проверка бана
const status = checkIn()

const root = createRoot(document.getElementById('root')!)
root.render(<p className="boot">Загружаю расписание…</p>)

Promise.all([loadSchedule(), status])
  .then(async ([, checked]) => {
    if (checked?.banned) {
      root.render(
        <div className="boot">
          <p className="boot-title">Доступ ограничен</p>
          <p>Владелец бота ограничил вам доступ к расписанию.</p>
        </div>,
      )
      return
    }
    // App подгружаем после данных: его модули читают schedule уже при запуске
    const { default: App } = await import('./App')
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((err) => {
    console.error(err)
    root.render(
      <div className="boot">
        <p>Не удалось загрузить расписание. Проверьте интернет.</p>
        <button type="button" className="boot-retry" onClick={() => location.reload()}>
          Повторить
        </button>
      </div>,
    )
  })
