import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installTelegramMock } from './dev/telegram-mock'
import './index.css'
import { initTelegram } from './telegram'

if (import.meta.env.DEV) installTelegramMock()
initTelegram()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
