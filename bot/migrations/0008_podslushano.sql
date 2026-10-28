-- Этап 5: «Подслушано» вместо досок. Одна доска на весь ГУУ — бывшая «Общая» (id «all»):
-- её сообщения и псевдонимы остаются. Доски групп 1-1 / 1-2 (g11, g12) удаляются целиком.
-- Рисовалку (штрихи, снимки) удаляет 0009 — после деплоя воркера, который их больше не читает.

DELETE FROM board_reactions WHERE message_id IN (SELECT id FROM board_messages WHERE board IN ('g11', 'g12'));
DELETE FROM board_reports WHERE message_id IN (SELECT id FROM board_messages WHERE board IN ('g11', 'g12'));
DELETE FROM board_messages WHERE board IN ('g11', 'g12');
DELETE FROM board_aliases WHERE board IN ('g11', 'g12');

-- Подпись к псевдониму «курс, институт» (переключатель в профиле, по умолчанию выключен)
ALTER TABLE users ADD COLUMN board_origin INTEGER NOT NULL DEFAULT 0;
-- подпись, с которой сообщение отправлено (NULL — без подписи); выключил — у старых стирается
ALTER TABLE board_messages ADD COLUMN origin TEXT;
