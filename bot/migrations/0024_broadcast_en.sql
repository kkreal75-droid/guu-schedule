-- Этап 11 (английская версия): английский текст рассылки. Получателю с английским языком уходит text_en,
-- а если его нет — обычный text. Кнопка (broadcasts.button, JSON) может нести text_en у себя.
ALTER TABLE broadcasts ADD COLUMN text_en TEXT;
