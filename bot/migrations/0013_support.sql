-- Этап 7.5: «Другое → Написать в поддержку». Обращение уходит владельцу в бот с кнопкой «Ответить»;
-- ответ владельца бот пересылает автору. Не больше 5 обращений за сутки от одного человека.
CREATE TABLE support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX support_messages_user ON support_messages (user_id, created_at);
