import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Эти файлы не встраиваются в JS, а лежат рядом с сайтом отдельно:
// schedule.json приложение скачивает при каждом запуске (см. loadSchedule в src/schedule.ts),
// а бот (bot/) берёт с сайта и правки, чтобы показывать то же расписание.
const DATA_FILES = ['schedule.json', 'overrides.json', 'overrides/thursday.json', 'overrides/thursday-1-2.json'].map((name) => ({
  name,
  path: resolve(import.meta.dirname, name),
}))

function dataFiles(): Plugin {
  return {
    name: 'data-files',
    configureServer(server) {
      for (const file of DATA_FILES) {
        server.middlewares.use(`/${file.name}`, (req, res, next) => {
          // «/overrides.json?import» — это приложение подключает файл как модуль: отдаёт сам Vite
          const query = new URLSearchParams(req.url?.split('?')[1] ?? '')
          if ([...query.keys()].some((key) => key !== 'v')) return next()
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(readFileSync(file.path))
        })
        server.watcher.add(file.path)
      }
      // update.py переписал файл — перезагружаем открытую страницу
      server.watcher.on('change', (changed) => {
        if (DATA_FILES.some((file) => file.path === changed)) server.ws.send({ type: 'full-reload' })
      })
    },
    generateBundle() {
      for (const file of DATA_FILES) {
        this.emitFile({ type: 'asset', fileName: file.name, source: readFileSync(file.path) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), dataFiles()],
  // относительные пути — сайт работает и в корне домена, и на GitHub Pages (/<repo>/)
  base: './',
})
