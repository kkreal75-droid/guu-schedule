import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installTelegramMock } from './dev/telegram-mock'
import './index.css'
import { loadSchedule } from './schedule'
import { initTelegram } from './telegram'

if (import.meta.env.DEV) installTelegramMock()
initTelegram()

const root = createRoot(document.getElementById('root')!)
root.render(<p className="boot">Загружаю расписание…</p>)

loadSchedule()
  // App подгружаем после данных: его модули читают schedule уже при запуске
  .then(() => import('./App'))
  .then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
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
