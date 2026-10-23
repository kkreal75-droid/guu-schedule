-- Этап 12: избранное над расписанием — группы и преподаватели вперемешку (JSON-список id: «b1-mb-mp-2»,
-- «t-koroleva-n-sh»), в порядке ленты; favorites_at — когда менялось (что новее: здесь или в облаке Telegram).
ALTER TABLE users ADD COLUMN favorites TEXT;
ALTER TABLE users ADD COLUMN favorites_at INTEGER;
