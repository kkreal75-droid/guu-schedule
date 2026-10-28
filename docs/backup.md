# Бэкапы базы бота (D1 `guu-bot`) и восстановление

## Откуда берутся бэкапы

- **Каждую ночь в 03:20 МСК** бот присылает владельцу в личку файл `guu-bot-ГГГГ-ММ-ДД.json.gz` — все таблицы D1
  (кроме служебной `tg_updates`), сжатый JSON. Вручную — команда `/backup` (только владельцу).
- В файле личные данные пользователей (имена, ники, группы) — **не пересылайте его** и держите чат с ботом приватным.
- Если файл больше 45 МБ, бот пришлёт предупреждение вместо файла: пора переносить бэкапы в R2.
- Дополнительно у D1 есть **Time Travel** — откат базы на момент в прошлом без всяких файлов (на бесплатном тарифе —
  за последние 7 дней). Это первый способ при «сломали базу только что».

## Восстановление

### 1. Откат на момент в прошлом (Time Travel) — если беда случилась недавно

```bash
cd bot
npx wrangler d1 time-travel info guu-bot                       # текущая закладка
npx wrangler d1 time-travel restore guu-bot --timestamp=2026-10-21T00:00:00Z
```

### 2. Из файла бэкапа — часть таблиц в живую базу

```bash
python3 scripts/d1_restore.py guu-bot-2026-10-21.json.gz --tables users,teacher_reviews --replace > restore.sql
cd bot && npx wrangler d1 execute guu-bot --remote --file ../restore.sql
```

Без `--replace` строки, которые уже есть (тот же первичный ключ), не трогаются — удобно «долить» пропавшее.

### 3. Из файла бэкапа — новая база целиком

```bash
cd bot
npx wrangler d1 create guu-bot-restore                         # id новой базы — в wrangler.jsonc вместо старого
npx wrangler d1 migrations apply guu-bot --remote               # схема (имя базы — из wrangler.jsonc)
python3 ../scripts/d1_restore.py guu-bot-2026-10-21.json.gz > ../restore.sql
npx wrangler d1 execute guu-bot --remote --file ../restore.sql
npm run deploy
```

Проверка: `npx wrangler d1 execute guu-bot --remote --command "SELECT COUNT(*) FROM users"` и `/stats` в боте.

Скрипт `scripts/d1_restore.py` только читает бэкап и печатает SQL — базу он не трогает.
