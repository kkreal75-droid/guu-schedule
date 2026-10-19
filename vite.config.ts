import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const SCHEDULE_FILE = resolve(import.meta.dirname, 'schedule.json')

// schedule.json не встраивается в JS, а лежит рядом с сайтом отдельным файлом:
// приложение скачивает его при каждом запуске (см. loadSchedule в src/schedule.ts).
function scheduleJson(): Plugin {
  return {
    name: 'schedule-json',
    configureServer(server) {
      server.middlewares.use('/schedule.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(SCHEDULE_FILE))
      })
      // update.py переписал файл — перезагружаем открытую страницу
      server.watcher.add(SCHEDULE_FILE)
      server.watcher.on('change', (file) => {
        if (file === SCHEDULE_FILE) server.ws.send({ type: 'full-reload' })
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'schedule.json', source: readFileSync(SCHEDULE_FILE) })
    },
  }
}

export default defineConfig({
  plugins: [react(), scheduleJson()],
  // относительные пути — сайт работает и в корне домена, и на GitHub Pages (/<repo>/)
  base: './',
})
