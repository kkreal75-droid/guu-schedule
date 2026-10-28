-- Этап 8.3: календарный учебный график. Типовой график по уровню, форме и курсу — в коде
-- (shared/calendar-core.ts), учёба осени — по расписанию (data/calendar.json); здесь — правки владельца из
-- админки: периоды на «уровень|форма|курс» или на одну программу («…|программа»). doc = 1 — сверено с
-- документом ГУУ (в приложении «по документу ГУУ»). Удалить строку — вернуть типовой график.
CREATE TABLE calendar_edits (
  scope TEXT PRIMARY KEY,
  periods TEXT NOT NULL,
  doc INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
