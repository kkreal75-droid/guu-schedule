-- Псевдонимы человека в «Подслушано» ищутся по user_id и семестру — индекс вместо чтения всей таблицы.
CREATE INDEX board_aliases_user ON board_aliases (user_id, semester);
