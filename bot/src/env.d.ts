// Секреты (npx wrangler secret put …) — `wrangler types` о них не знает, объявляем сами.
interface Secrets {
  BOT_TOKEN: string
  OWNER_ID: string // Telegram ID владельца — админа бота
  TELEGRAM_API?: string // только для локальной проверки с поддельным Telegram
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
