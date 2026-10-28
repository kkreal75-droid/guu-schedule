-- Этап 11 (английская версия): lang — язык, выбранный человеком (ru / en; NULL — не выбирал, берём из Telegram),
-- lang_code — language_code из Telegram (обновляется при визитах).
ALTER TABLE users ADD COLUMN lang TEXT;
ALTER TABLE users ADD COLUMN lang_code TEXT;
