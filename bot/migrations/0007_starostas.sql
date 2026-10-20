-- Старосты и подгруппы.
--   users.starosta_of — группа, правки которой может делать этот человек (назначает владелец)
--   users.subgroups   — JSON-список id выбранных подгрупп (видит только свои пары)
--   schedule_edits: author_id (NULL — владелец из админки), data (JSON для add / move), reverted_at
--     (владелец откатил правку — она больше не действует, но видна в истории)
ALTER TABLE users ADD COLUMN starosta_of TEXT;
ALTER TABLE users ADD COLUMN subgroups TEXT;

ALTER TABLE schedule_edits ADD COLUMN author_id INTEGER;
ALTER TABLE schedule_edits ADD COLUMN data TEXT;
ALTER TABLE schedule_edits ADD COLUMN reverted_at INTEGER;
CREATE INDEX schedule_edits_grp ON schedule_edits (grp, date);

-- Подгруппы группы: «Англ — Цунаева», «Англ — Замятина»
CREATE TABLE subgroups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX subgroups_grp ON subgroups (grp);

-- Пара из файла ГУУ относится к подгруппе: день недели + время + предмет (+ преподаватель)
CREATE TABLE lesson_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  start TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher TEXT,
  subgroup_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX lesson_tags_grp ON lesson_tags (grp);
