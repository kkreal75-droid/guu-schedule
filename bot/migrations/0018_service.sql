-- Служебное (только добавляет): обработанные обновления Telegram (повтор того же update_id — пропускаем),
-- журнал действий владельца (кто, что, когда; в интерфейсе не показывается) и дневной расход бесплатных
-- лимитов Cloudflare (счётчики воркера, «режим экономии» и отправленные тревоги — тоже строками).
CREATE TABLE tg_updates (
  update_id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX tg_updates_at ON tg_updates (at);

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT
);
CREATE INDEX admin_log_at ON admin_log (at);

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
