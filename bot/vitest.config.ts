// Автотесты безопасности воркера: запускаются в настоящем рантайме Workers (Miniflare) с D1 и KV из
// wrangler.jsonc. Секреты — тестовые; Telegram и сайт подменяются в тестах (test/helpers.ts), в сеть не ходим.
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            BOT_TOKEN: '123456:TEST-TOKEN-FOR-AUTOTESTS',
            OWNER_ID: '7',
            BOARD_SALT: 'test-salt',
            WEBAPP_URL: 'https://site.test/',
            TELEGRAM_API: 'https://tg.test',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  }
})
