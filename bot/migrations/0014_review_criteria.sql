-- Этап 7.6: отзыв по трём критериям (1–5) + «Рекомендую / Не рекомендую»; общая оценка — среднее критериев
-- (score — точное, rating — округлённое, как раньше). Старые отзывы (только rating) остаются как есть.
ALTER TABLE teacher_reviews ADD COLUMN clarity INTEGER;        -- понятность
ALTER TABLE teacher_reviews ADD COLUMN competence INTEGER;     -- компетентность
ALTER TABLE teacher_reviews ADD COLUMN communication INTEGER;  -- коммуникация
ALTER TABLE teacher_reviews ADD COLUMN recommend INTEGER;      -- 1 — рекомендует, 0 — нет, NULL — старый отзыв
ALTER TABLE teacher_reviews ADD COLUMN score REAL;             -- среднее критериев (у старых — NULL, берётся rating)

-- «Полезно / не полезно»: одна отметка от человека на отзыв
CREATE TABLE review_votes (
  review_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (review_id, user_id)
);
