-- Этап 11: правки английских переводов владельца (админ-панель → «Переводы») поверх словарей на сайте
-- (data/i18n/subjects.en.json — предметы, data/i18n/guu.en.json — институты, направления, программы).
-- kind: subject | institute | direction | program; ru — как в файлах ГУУ.
CREATE TABLE translations (
  kind TEXT NOT NULL,
  ru TEXT NOT NULL,
  en TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, ru)
);
