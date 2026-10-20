// Имя бота — для ссылок t.me (в bot/wrangler.jsonc то же значение, сверяется через getMe)
export const BOT_USERNAME = 'GUU_Scheduule_bot'

// Будущая оплата — только структура (у пользователя в базе есть access: free_forever / standard).
// Сейчас всё бесплатно для всех: ни замков, ни кнопок оплаты. Логика платного доступа не реализована.
export const PAYWALL_ENABLED = false
