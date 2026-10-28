-- Этап 7.4: «Спорт» — секции и их занятия. Машиночитаемого расписания секций на guu.ru нет, поэтому
-- их ведёт владелец в админке (вручную или импортом CSV / xlsx). Приложение читает GET /sport.
CREATE TABLE sport_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,                 -- «Волейбол»
  emoji TEXT,                                -- NULL — подберётся по названию
  teacher TEXT,                              -- преподаватель по умолчанию
  place TEXT,                                -- место по умолчанию («Спортивный комплекс, зал №2»)
  place_id TEXT,                             -- место из «Корпусов ГУУ» (data/places.json), если есть
  about TEXT,                                -- пара строк о секции
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sport_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 — понедельник
  start TEXT NOT NULL,                       -- «09:00»
  end TEXT NOT NULL,
  weeks TEXT NOT NULL DEFAULT '',            -- '' — каждую неделю, 'even' / 'odd', или «1-8,10»
  teacher TEXT,                              -- NULL — как у секции
  place TEXT,                                -- NULL — как у секции
  updated_at INTEGER NOT NULL
);
CREATE INDEX sport_sessions_section ON sport_sessions (section_id);
