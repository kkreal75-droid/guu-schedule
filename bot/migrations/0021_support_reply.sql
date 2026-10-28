-- Ответ на обращение в поддержку можно поставить в очередь (reply_text): cron отправит его автору тем же
-- сообщением «💬 Ответ на твоё обращение», что и ответ из Telegram, и отметит answered_at.
ALTER TABLE support_messages ADD COLUMN reply_text TEXT;
