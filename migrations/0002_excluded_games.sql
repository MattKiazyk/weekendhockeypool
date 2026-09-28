CREATE TABLE excluded_games (
  weekend_start TEXT NOT NULL REFERENCES weekends(start_date) ON DELETE CASCADE,
  game_id INTEGER NOT NULL,
  PRIMARY KEY (weekend_start, game_id)
);
