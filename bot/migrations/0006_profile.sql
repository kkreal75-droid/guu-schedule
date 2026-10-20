-- Онбординг и подготовка к будущей оплате (сама оплата не включена: PAYWALL_ENABLED = false).
--   role       — student / teacher; NULL — ещё не выбирал (старые пользователи — студенты МБ)
--   teacher_id — id преподавателя из teachers.json (для роли teacher)
--   access     — free_forever / standard. free_forever: МБ(МП) 1-1 и 1-2 и все, кто есть в базе
--                на момент релиза; standard — остальные. Владелец меняет вручную в админке.
--   legacy     — был в базе до релиза онбординга: онбординг не показываем, группа по умолчанию — МБ 1-1
--   onboarded_at — когда прошёл онбординг (или сменил группу/роль)
ALTER TABLE users ADD COLUMN role TEXT;
ALTER TABLE users ADD COLUMN teacher_id TEXT;
ALTER TABLE users ADD COLUMN access TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE users ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarded_at INTEGER;

UPDATE users SET legacy = 1, access = 'free_forever';
