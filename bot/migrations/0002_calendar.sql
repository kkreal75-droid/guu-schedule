-- Подписки на календарь: случайный токен → пользователь и группа
CREATE TABLE calendar_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  grp TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_fetch_at INTEGER,                 -- когда календарь последний раз забирал .ics
  fetch_count INTEGER NOT NULL DEFAULT 0
);
