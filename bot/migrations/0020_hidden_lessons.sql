-- «Это не моя пара»: человек скрывает пару у себя (приложение, календарь, inline, /today в личке).
-- Пара — как в файле ГУУ: день недели, начало, предмет, вид. scope: day (только date), even / odd (по чётным /
-- нечётным неделям), always. user_id = 0 — скрыто для всей группы (владелец в админ-панели, видно всем).
-- Пустая строка вместо NULL в kind и date — чтобы уникальный индекс не пропускал дубли.
CREATE TABLE hidden_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  grp TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  start TEXT NOT NULL,
  subject TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX hidden_lessons_key ON hidden_lessons (user_id, grp, weekday, start, subject, kind, scope, date);
CREATE INDEX hidden_lessons_group ON hidden_lessons (grp, user_id);
