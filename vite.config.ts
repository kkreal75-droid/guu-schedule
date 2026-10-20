import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Эти файлы не встраиваются в JS, а лежат рядом с сайтом отдельно: бот (bot/) берёт с сайта правки,
// чтобы показывать то же расписание; schedule.json (только МБ(МП) 1-1/1-2) — для старых версий
// приложения, которые Telegram ещё держит в кэше. Данные всего ГУУ (public/data/: группы, пары,
// преподаватели, аудитории) Vite кладёт на сайт сам — как всё из public/.
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

// версия в «Профиле»: из package.json + дата сборки и коммит (GITHUB_SHA есть в GitHub Actions)
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }
const BUILD = { version: pkg.version, date: new Date().toISOString().slice(0, 10), sha: (process.env.GITHUB_SHA ?? '').slice(0, 7) }

export default defineConfig({
  plugins: [react(), dataFiles()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  // относительные пути — сайт работает и в корне домена, и на GitHub Pages (/<repo>/)
  base: './',
})
