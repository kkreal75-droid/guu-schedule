-- Этап 8.2: кнопка под рассылкой — например, «Открыть расписание сессии» (мини-приложение). JSON {text, url}.
ALTER TABLE broadcasts ADD COLUMN button TEXT;
