-- Этап 7.7: «Корпуса ГУУ». Места лежат в public/data/places.json (в репозитории); владелец правит их в админке
-- («Места»): правка поверх места из файла или новое место. data — JSON полей (name, short, icon, group,
-- address, lat, lon, howto, note, todo, rooms, aliases, hidden). Удалить строку — вернуть место как в файле.
CREATE TABLE place_edits (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
