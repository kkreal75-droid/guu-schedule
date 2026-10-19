-- Пользователи бота и мини-приложения. Время — миллисекунды Unix.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,                -- Telegram user id
  username TEXT,
  name TEXT,                             -- имя и фамилия из профиля Telegram
  grp TEXT,                              -- группа из приложения: «МБ(МП) 1-1» / «МБ(МП) 1-2»
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,     -- открытия приложения (повтор в течение 10 минут — одно)
  last_open INTEGER,
  starts INTEGER NOT NULL DEFAULT 0,     -- сколько раз нажимал /start
  can_message INTEGER NOT NULL DEFAULT 0,-- писал боту в личку — значит, бот может ему писать
  blocked_bot INTEGER NOT NULL DEFAULT 0,-- заблокировал бота (выяснилось при рассылке)
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  banned_at INTEGER,
  board_banned_until INTEGER             -- бан только на доске (этап 5); NULL — нет
);
CREATE INDEX users_username ON users (username COLLATE NOCASE);
CREATE INDEX users_last_seen ON users (last_seen);

-- Журнал визитов — для графиков в админке
CREATE TABLE visits (
  user_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL                     -- 'open' — приложение, 'start' — /start
);
CREATE INDEX visits_ts ON visits (ts);

-- Рассылки и очередь доставки
CREATE TABLE broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  text TEXT NOT NULL,                    -- HTML
  photo TEXT,                            -- file_id фото, если есть
  audience TEXT,                         -- all / 1-1 / 1-2
  status TEXT NOT NULL,                  -- draft / sending / done / cancelled
  preview_chat INTEGER,
  preview_message INTEGER,
  total INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER
);

CREATE TABLE broadcast_queue (
  broadcast_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending / delivered / blocked / failed
  error TEXT,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX broadcast_queue_pending ON broadcast_queue (status, broadcast_id);
