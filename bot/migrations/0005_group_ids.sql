-- Расписание всего ГУУ: группы теперь хранятся по id (реестр data/group_ids.json, его ведёт update.py).
-- МБ(МП) 1-1 и 1-2 раньше хранились по имени — переводим. Код понимает и старые имена,
-- так что порядок «деплой воркера → миграция» безопасен.
UPDATE users SET grp = 'b1-mb-mp-1' WHERE grp = 'МБ(МП) 1-1';
UPDATE users SET grp = 'b1-mb-mp-2' WHERE grp = 'МБ(МП) 1-2';
UPDATE calendar_tokens SET grp = 'b1-mb-mp-1' WHERE grp = 'МБ(МП) 1-1';
UPDATE calendar_tokens SET grp = 'b1-mb-mp-2' WHERE grp = 'МБ(МП) 1-2';
UPDATE schedule_edits SET grp = 'b1-mb-mp-1' WHERE grp = 'МБ(МП) 1-1';
UPDATE schedule_edits SET grp = 'b1-mb-mp-2' WHERE grp = 'МБ(МП) 1-2';
UPDATE board_members SET board_grp = 'b1-mb-mp-1' WHERE board_grp = 'МБ(МП) 1-1';
UPDATE board_members SET board_grp = 'b1-mb-mp-2' WHERE board_grp = 'МБ(МП) 1-2';

-- Снимки «пары на 7 дней» для «Изменения в расписании» (раньше — KV snapshot:1-1|1-2):
-- групп с беседами может быть много, а у KV всего 1000 записей в сутки
CREATE TABLE group_snapshots (
  grp TEXT PRIMARY KEY,                  -- id группы
  data TEXT NOT NULL,                    -- JSON: дата → пары строками
  updated_at INTEGER NOT NULL
);
