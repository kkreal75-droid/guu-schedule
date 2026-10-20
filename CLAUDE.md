# Расписание ГУУ — Telegram Mini App + бот

Расписание групп **МБ(МП) 1-1** и **МБ(МП) 1-2** (1 курс, ГУУ) для студентов этих групп.
Мини-приложение в Telegram (@GUU_Scheduule_bot, кнопка меню и `/start`) + бот: команды, inline,
автосообщения в беседы групп, живой календарь, анонимная доска, админ-панель владельца.
Всё бесплатно: GitHub Pages + бесплатный тариф Cloudflare Workers / D1 / KV.

## Архитектура

| Часть | Где | Что |
|---|---|---|
| Фронт | `src/` (React 19, Vite 8, TypeScript) | мини-приложение, хостинг — GitHub Pages `https://kkreal75-droid.github.io/guu-schedule/` |
| Общая логика | `shared/` | `schedule-core.ts` (формат, правки, недели, пары на день), `format-core.ts` — одна для фронта и бота |
| Бот | `bot/` (Cloudflare Worker `guu-schedule-bot`) | `https://guu-schedule-bot.guu-schedule-bot.workers.dev`, вебхук Telegram |
| Данные расписания | `schedule.json` (корень) | вывод `parser.py` из xlsx ГУУ (`data/raw/k1.xlsx`) |
| Ручные правки | `overrides.json`, `overrides/thursday.json` | накладываются поверх `schedule.json` (см. ниже) |
| Автообновление | `update.py` + `.github/workflows/deploy.yml` | раз в час проверяет guu.ru |

**Сайт.** Vite отдаёт/кладёт рядом с сайтом `schedule.json`, `overrides.json`, `overrides/thursday.json`
(плагин `dataFiles` в `vite.config.ts`). Приложение качает `schedule.json` при каждом запуске
(`?v=<время>`, `no-store`, копия в localStorage на случай без сети); правки встроены в бандл.
Бот берёт те же три файла с сайта (кэш CDN 120 с + 60 с в памяти воркера).

**GitHub Actions (`deploy.yml`).** push в main → сборка и деплой Pages; cron `17 * * * *` →
`update.py` → коммит `schedule.json` + `data/raw/k1.xlsx`, только если пары изменились → деплой;
`workflow_dispatch` (вход `force`) — то же вручную (кнопка «Обновить сейчас» в админке).

**update.py.** Ищет на `https://guu.ru/student/schedule/` ссылку «1 курс бакалавриат ОФО», сравнивает
SHA-256 файла с `source_sha256`, запускает `parser.py` во временной папке, требует ≥30 пар у каждой
группы (`MIN_LESSONS`), пишет `updated_at` / `source_file` / `source_sha256`. User-Agent без слова «bot»
(иначе guu.ru даёт 403), SSL через certifi. **`parser.py` не менять — логика проверена.**

**Воркер — эндпоинты** (`bot/src/index.ts`):
- `POST /webhook` — обновления Telegram (секрет в заголовке = SHA-256 от `webhook:`+токен);
- `POST /seen` — открытие приложения: initData → визит; ответ `{banned, admin, board, edits, notice, maintenance}`;
- `POST /cal/status|connect|disconnect`, `GET /cal/<токен>.ics`, `GET /cal/<токен>/apple` (страница webcal для iPhone);
- `POST /board/<enter|accept|poll|send|react|report|delete|stroke|undo|erase|clear>` — доска;
- `POST /admin/<…>` — админ-панель (`admin-api.ts`), только OWNER_ID, остальным 403 на любой адрес;
- `GET /` — setWebhook + меню команд (`?force` — заново) + строка о данных в описании бота;
- cron `* * * * *`: сводки в беседы, раз в 10 мин (минута %10 = 5) сверка изменений на 7 дней,
  в :35 — чистка доски, остаток лимита — досылка рассылок (≤30 сообщений за запуск, пауза 50 мс).

**D1 `guu-bot`** (миграции `bot/migrations/0001…0004`): `users`, `visits`, `broadcasts`, `broadcast_queue`,
`calendar_tokens`, `board_aliases`, `board_members`, `board_messages`, `board_reactions`, `board_reports`,
`board_strokes`, `board_snapshots`, `schedule_edits`.
**KV** (редкие записи, лимит 1000/сутки): `chats` (настройки бесед, тема форума), `settings` (приветствия,
техработы, объявление), `snapshot:1-1|1-2` (пары на 7 дней для «Изменения»), `sent:<дата>:<слот>`
(уже отправленные сводки, TTL 3 дня), `board-snapshot:<id>` (PNG холста перед очисткой).

**Команды бота.** Личка: `/start` (одно из 3 приветствий), `/today`, `/tomorrow`.
Владелец (у остальных молчат): `/stats`, `/broadcast`, `/broadcasts`, `/export`, `/ban`, `/unban`, `/bans`,
`/boardban id [дни]` (без дней — навсегда, 0 — снять). Беседы: `/setup` (админы: группа + время 7:00/7:30/8:00/выкл),
`/today`, `/tomorrow`, `/here` (рассылка в эту тему форума), `/off`. Inline: `@GUU_Scheduule_bot сегодня|завтра|пн…сб|неделя`.

## Команды

```bash
npm run dev                      # фронт; ?tg&uid=7&name=… — эмулятор Telegram (src/dev/telegram-mock.ts)
npm run build                    # tsc -b && vite build → dist/
cd bot && npm run check          # wrangler types + tsc
cd bot && npm run deploy         # деплой воркера, затем: curl https://guu-schedule-bot.guu-schedule-bot.workers.dev/?force
cd bot && npx wrangler d1 migrations apply guu-bot --remote   # и проверить: … migrations list guu-bot --remote
```
Сайт деплоится только через push в main (GitHub Actions). Локально: `bot/.dev.vars` (тестовый токен
`123456:LOCAL-TEST-TOKEN`, `TELEGRAM_API`/`GITHUB_API` на поддельные сервера) и `.env.development.local`
(`VITE_BOT_URL=http://127.0.0.1:8787`) — оба в .gitignore, в git не класть. Автотестов в репозитории нет.

## Секреты (Cloudflare, `npx wrangler secret put <ИМЯ>` в `bot/`)

`BOT_TOKEN`, `OWNER_ID` (Telegram ID владельца), `BOARD_SALT` (ключ псевдонимов доски, не менять),
`GITHUB_TOKEN` (fine-grained PAT только на этот репозиторий, Actions: read & write — для «Обновить сейчас»).
Только для локальной проверки: `TELEGRAM_API`, `GITHUB_API`. Vars в `wrangler.jsonc`: `WEBAPP_URL`,
`BOT_USERNAME`, `GITHUB_REPO`, `GITHUB_WORKFLOW`. **Секреты вводит владелец сам** — не вводить за него,
не писать в код, git и чат.

## Правила и решения

- Большие задачи — по этапам: проверить → коммит + push → деплой воркера и сайта → следующий этап.
  Не получилось — остановиться и сказать, остальное не ломать.
- Главный экран — расписание с переключателем 1-1 / 1-2 (группа по умолчанию — в «Профиле»).
  Нижнее меню: «Расписание», «Ещё», «Профиль». Всё новое — внутри «Ещё»: Доска, Календарь на телефоне,
  Бот в беседе группы, «Админ-панель» (только владельцу, у остальных ни пункта, ни намёка).
  На расписании никаких попапов/баннеров, кроме объявления из админки (плашка с крестиком).
  Новое на доске — только точка на «Ещё» и «Доска». Цвета — тема Telegram.
- Админ = `OWNER_ID`; права проверяет воркер (подпись initData или chat id), не только фронт.
  Все записи из приложения — через воркер с проверкой initData (не старше суток).
- Любая ошибка: пользователю «Что-то сломалось 🛠», владельцу в личку — текст ошибки (`errors.ts`).
- Частые записи — D1, KV — только редкие. Укладываться в бесплатные лимиты (50 подзапросов на вызов,
  10 мс CPU, D1 100 тыс. записей/сутки).
- Чётность недели: `неделя % 2 === 0` — чётная; 1-я неделя с `semester_start` (31.08.2026);
  20.10.2026 — 8-я, чётная.
- `schedule.json` — чистый вывод `parser.py`. Правки — поверх, в `makeTimetable`: `overrides.json`
  (remove/add пар) → замены дня целиком (`overrides/thursday.json`: **четверг МБ(МП) 1-1** — все пары ГУУ
  заменяются, `even`/`odd` по чётности, тип «Практика», весь семестр). Новый файл замены — добавить в
  `DATA_FILES` (vite.config.ts), импорт в `src/schedule.ts` и `REPLACEMENT_FILES` в `bot/src/schedule.ts`.
- Разовые правки из админки (отмена пары / пометка) — D1 `schedule_edits`; видны в приложении (зачёркнуто /
  жёлтая пометка), `/today`, inline, беседах, календаре; файловые правки там же с пометкой «из файла».
- Доска: **одна общая** (чат + рисовалка), доски групп убраны (старые записи `g11`/`g12` скрыты, крон
  дочищает). Псевдонимы «Выдра 🦦» = HMAC(id + доска + семестр, BOARD_SALT), уникальны; обычным
  пользователям — ни id, ни имён; админ видит авторов. Экран входа — только «Для других ты аноним.»
  Лимиты: 500 символов, 1 сообщение / 5 с, 100 / сутки, 60 штрихов / мин, 600 / сутки, 1500 штрихов на
  холсте, сообщения живут 30 дней, фильтр мата — `board-config.ts`. 3 жалобы — скрыто до решения.
  Опрос раз в 4 с (15 с после 3 мин без касаний), без WebSocket.
- Беседы-форумы: ответ в ту же тему (`message_thread_id`, если `is_topic_message`; General — без темы);
  тема рассылки — из `/setup` или `/here`; тема удалена/закрыта — в General не писать, владельцу ошибку.
- Telegram открывает из приложения только http(s): `webcal://` — через `/cal/<токен>/apple`.
- Коммиты — по-русски, по смыслу этапа.

## Состояние (20.10.2026)

Работает в проде: расписание + заметки (CloudStorage) + профиль; ежечасное автообновление; `/start`
с приветствиями из админки; `/stats`, рассылки, экспорт CSV, баны; inline; бот в беседах (у «МБ 1-1» — форум,
рассылка привязана к теме «Расписание», id 11); живой календарь (Apple/Google); общая анонимная доска;
админ-панель (дашборд, пользователи, рассылка, модерация, расписание, настройки); четверг 1-1 из файла.

Известные проблемы:
- `GITHUB_TOKEN` не задан → «Обновить сейчас» в админке выключена (автообновление по часам работает).
- Ссылка `t.me/GUU_Scheduule_bot/schedule` (кнопка в inline) не проверена; если не открывает приложение —
  BotFather → `/newapp`, короткое имя `schedule`.
- Не проверено вживую: доска с двух аккаунтов (жалоба владельцу), inline в чужом чате, `/setup` в новой беседе.
- GitHub Actions бывает в очереди надолго (сбой 19.10) — сайт обновляется позже воркера; Telegram держит
  старую версию приложения, пока его не закрыть полностью.
- «Изменение в расписании» не приходит для дней, которые только вошли в окно 7 дней (так задумано).
- Четверг 1-2 — данные ГУУ (заменён только 1-1); `marketing/` (иконка рассылки) не в git.
