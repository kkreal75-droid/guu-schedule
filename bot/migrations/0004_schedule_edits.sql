-- Ручные правки расписания из админ-панели: отменить пару или добавить пометку.
-- Хранятся отдельно от schedule.json — автообновление их не трогает.
CREATE TABLE schedule_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL,            -- МБ(МП) 1-1 / МБ(МП) 1-2
  date TEXT NOT NULL,           -- ГГГГ-ММ-ДД
  start TEXT,                   -- ЧЧ:ММ начала пары; NULL — пометка ко всему дню
  kind TEXT NOT NULL,           -- cancel / note
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX schedule_edits_date ON schedule_edits (date);
