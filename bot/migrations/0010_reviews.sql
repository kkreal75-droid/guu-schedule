-- Этап 6: рейтинг преподавателей. Отзыв — один от человека на преподавателя (можно изменить и удалить).
-- Оставить можно, только если преподаватель ведёт / вёл в прошлом семестре пары у группы автора (проверяет
-- воркер по data/teachers/<id>.json). Автор анонимен для всех, кроме владельца.
CREATE TABLE teacher_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id TEXT NOT NULL,                   -- id из teachers.json («denisova-i-v»)
  user_id INTEGER NOT NULL,
  grp TEXT,                                   -- группа автора на момент отзыва (видит владелец)
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  discipline TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,         -- 1 — удалил автор, 2 — удалил владелец
  hidden INTEGER NOT NULL DEFAULT 0,          -- 3+ жалобы от разных людей — скрыт до решения владельца
  UNIQUE (teacher_id, user_id)
);
CREATE INDEX teacher_reviews_teacher ON teacher_reviews (teacher_id, deleted, hidden);
CREATE INDEX teacher_reviews_created ON teacher_reviews (created_at);

CREATE TABLE review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open / deleted / kept
  UNIQUE (review_id, reporter_id)
);
CREATE INDEX review_reports_status ON review_reports (status, review_id);

-- бан в отзывах (до какого момента; «навсегда» — 31.12.9999): читать можно, писать и жаловаться — нет
ALTER TABLE users ADD COLUMN review_banned_until INTEGER;
