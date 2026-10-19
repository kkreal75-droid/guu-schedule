-- Анонимная доска. Доски: g11 (МБ(МП) 1-1), g12 (МБ(МП) 1-2), all (общая).
-- updated_at — для опроса «что изменилось с прошлого раза» (новое, удалённое, реакции).

-- Псевдонимы: уникальны в пределах доски и семестра; однажды выданный не меняется
CREATE TABLE board_aliases (
  board TEXT NOT NULL,
  semester TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (board, semester, user_id),
  UNIQUE (board, semester, alias)
);

-- Участник доски: принял правила, группа закреплена при первом входе, счётчики лимитов
CREATE TABLE board_members (
  user_id INTEGER PRIMARY KEY,
  rules_accepted_at INTEGER,
  board_grp TEXT,
  day TEXT,                                   -- дата (МСК), к которой относятся дневные счётчики
  day_messages INTEGER NOT NULL DEFAULT 0,
  day_strokes INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  minute_at INTEGER,                          -- начало текущей минуты для лимита штрихов
  minute_strokes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE board_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  text TEXT NOT NULL,
  reply_to INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0           -- 3+ жалобы от разных людей — скрыто до решения админа
);
CREATE INDEX board_messages_updated ON board_messages (board, updated_at);
CREATE INDEX board_messages_created ON board_messages (board, created_at);
CREATE INDEX board_messages_user ON board_messages (user_id, created_at);

CREATE TABLE board_reactions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE board_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open / deleted / ignored
  UNIQUE (message_id, reporter_id)
);
CREATE INDEX board_reports_status ON board_reports (status, message_id);

-- Рисовалка: векторные штрихи; points — JSON-массив [x1, y1, x2, y2, …], координаты 0…1000
CREATE TABLE board_strokes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  color TEXT NOT NULL,
  width INTEGER NOT NULL,
  points TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX board_strokes_updated ON board_strokes (board, updated_at);
CREATE INDEX board_strokes_user ON board_strokes (user_id, board, deleted);

-- Снимки холста перед очисткой; сама картинка (PNG) — в KV под ключом board-snapshot:<id>
CREATE TABLE board_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  strokes INTEGER NOT NULL,
  bytes INTEGER NOT NULL
);
