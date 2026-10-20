import { applyD1Migrations, env } from 'cloudflare:test'

// у каждого файла тестов своя чистая D1 — схема из migrations/
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS)
