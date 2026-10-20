// Секреты (npx wrangler secret put …) — `wrangler types` о них не знает, объявляем сами.
interface Secrets {
  BOT_TOKEN: string
  OWNER_ID: string // Telegram ID владельца — админа бота
  BOARD_SALT?: string // ключ для псевдонимов в «Подслушано»; без него оно выключено
  GITHUB_TOKEN?: string // «Обновить сейчас» в админ-панели: fine-grained, только Actions этого репозитория
  GITHUB_API?: string // только для локальной проверки с поддельным GitHub
  TELEGRAM_API?: string // только для локальной проверки с поддельным Telegram
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
