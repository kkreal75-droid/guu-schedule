-- Этап 5: рисовалки больше нет — штрихи, снимки холста и их счётчики удаляются.
-- Применять после деплоя воркера без рисовалки (иначе старый воркер упадёт на чистке в :35).
-- Картинки снимков (KV board-snapshot:<id>) удаляются отдельно, через wrangler kv key delete.

DROP TABLE IF EXISTS board_strokes;
DROP TABLE IF EXISTS board_snapshots;

-- board_grp — группа доски (доски групп убраны), остальное — лимиты штрихов
ALTER TABLE board_members DROP COLUMN board_grp;
ALTER TABLE board_members DROP COLUMN day_strokes;
ALTER TABLE board_members DROP COLUMN minute_at;
ALTER TABLE board_members DROP COLUMN minute_strokes;
