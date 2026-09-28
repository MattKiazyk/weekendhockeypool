CREATE TABLE leagues (
  id TEXT PRIMARY KEY
);
INSERT INTO leagues (id) VALUES ('nhl'), ('pwhl');

CREATE TABLE weekends_next (
  league TEXT NOT NULL REFERENCES leagues(id),
  start_date TEXT NOT NULL,
  season TEXT NOT NULL,
  lock_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'final')),
  last_schedule_sync TEXT,
  last_result_sync TEXT,
  finalized_at TEXT,
  PRIMARY KEY (league, start_date)
);

CREATE TABLE games_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  source_game_id INTEGER NOT NULL,
  weekend_start TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  eastern_date TEXT NOT NULL,
  away_code TEXT NOT NULL,
  away_name TEXT NOT NULL,
  away_logo TEXT,
  home_code TEXT NOT NULL,
  home_name TEXT NOT NULL,
  home_logo TEXT,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'live', 'final', 'void')),
  away_score INTEGER,
  home_score INTEGER,
  winner TEXT CHECK (winner IN ('away', 'home')),
  source TEXT NOT NULL DEFAULT 'feed' CHECK (source IN ('feed', 'admin')),
  UNIQUE (league, source_game_id),
  FOREIGN KEY (league, weekend_start) REFERENCES weekends_next(league, start_date) ON DELETE CASCADE
);

CREATE TABLE entries_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  weekend_start TEXT NOT NULL,
  clerk_id TEXT NOT NULL REFERENCES players(clerk_id),
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (league, weekend_start, clerk_id),
  FOREIGN KEY (league, weekend_start) REFERENCES weekends_next(league, start_date) ON DELETE CASCADE
);

CREATE TABLE picks_next (
  entry_id INTEGER NOT NULL REFERENCES entries_next(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games_next(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('away', 'home')),
  confidence INTEGER NOT NULL CHECK (confidence > 0),
  PRIMARY KEY (entry_id, game_id),
  UNIQUE (entry_id, confidence)
);

CREATE TABLE standings_next (
  league TEXT NOT NULL,
  weekend_start TEXT NOT NULL,
  clerk_id TEXT NOT NULL REFERENCES players(clerk_id),
  points INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (league, weekend_start, clerk_id),
  FOREIGN KEY (league, weekend_start) REFERENCES weekends_next(league, start_date) ON DELETE CASCADE
);

CREATE TABLE excluded_games_next (
  league TEXT NOT NULL,
  weekend_start TEXT NOT NULL,
  source_game_id INTEGER NOT NULL,
  PRIMARY KEY (league, weekend_start, source_game_id),
  FOREIGN KEY (league, weekend_start) REFERENCES weekends_next(league, start_date) ON DELETE CASCADE
);

INSERT INTO weekends_next SELECT 'nhl', start_date, season, lock_at, status, last_schedule_sync,
  last_result_sync, finalized_at FROM weekends;
INSERT INTO games_next SELECT id, 'nhl', id, weekend_start, start_utc, eastern_date,
  away_code, away_name, away_logo, home_code, home_name, home_logo, state, away_score,
  home_score, winner, CASE WHEN source='admin' THEN 'admin' ELSE 'feed' END FROM games;
INSERT INTO entries_next SELECT id, 'nhl', weekend_start, clerk_id, submitted_at, updated_at
  FROM entries;
INSERT INTO picks_next SELECT entry_id, game_id, side, confidence FROM picks;
INSERT INTO standings_next SELECT 'nhl', weekend_start, clerk_id, points, correct, rank
  FROM standings;
INSERT INTO excluded_games_next SELECT 'nhl', weekend_start, game_id FROM excluded_games;

DROP TABLE picks;
DROP TABLE standings;
DROP TABLE excluded_games;
DROP TABLE entries;
DROP TABLE games;
DROP TABLE weekends;

ALTER TABLE weekends_next RENAME TO weekends;
ALTER TABLE games_next RENAME TO games;
ALTER TABLE entries_next RENAME TO entries;
ALTER TABLE picks_next RENAME TO picks;
ALTER TABLE standings_next RENAME TO standings;
ALTER TABLE excluded_games_next RENAME TO excluded_games;

CREATE INDEX games_by_week ON games(league, weekend_start, start_utc);
CREATE INDEX standings_by_week ON standings(league, weekend_start, points DESC);

CREATE TRIGGER entries_before_insert BEFORE INSERT ON entries
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;
CREATE TRIGGER entries_before_update BEFORE UPDATE ON entries
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;
CREATE TRIGGER picks_before_insert BEFORE INSERT ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w
    ON w.league=e.league AND w.start_date=e.weekend_start
  JOIN games g ON g.id=NEW.game_id AND g.league=e.league AND g.weekend_start=e.weekend_start
  WHERE e.id=NEW.entry_id AND w.status='open' AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed or game belongs to another pool');
END;
CREATE TRIGGER picks_before_update BEFORE UPDATE ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w
    ON w.league=e.league AND w.start_date=e.weekend_start
  JOIN games g ON g.id=NEW.game_id AND g.league=e.league AND g.weekend_start=e.weekend_start
  WHERE e.id=NEW.entry_id AND w.status='open' AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed or game belongs to another pool');
END;
CREATE TRIGGER picks_before_delete BEFORE DELETE ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w
    ON w.league=e.league AND w.start_date=e.weekend_start
  WHERE e.id=OLD.entry_id AND w.status='open' AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;
