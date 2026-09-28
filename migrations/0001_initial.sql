PRAGMA foreign_keys = ON;

CREATE TABLE players (
  clerk_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE weekends (
  start_date TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  lock_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'final')),
  last_schedule_sync TEXT,
  last_result_sync TEXT,
  finalized_at TEXT
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  weekend_start TEXT NOT NULL REFERENCES weekends(start_date) ON DELETE CASCADE,
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
  source TEXT NOT NULL DEFAULT 'nhl' CHECK (source IN ('nhl', 'admin'))
);
CREATE INDEX games_by_week ON games(weekend_start, start_utc);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekend_start TEXT NOT NULL REFERENCES weekends(start_date) ON DELETE CASCADE,
  clerk_id TEXT NOT NULL REFERENCES players(clerk_id),
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(weekend_start, clerk_id)
);

CREATE TABLE picks (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('away', 'home')),
  confidence INTEGER NOT NULL CHECK (confidence > 0),
  PRIMARY KEY(entry_id, game_id),
  UNIQUE(entry_id, confidence)
);

CREATE TABLE standings (
  weekend_start TEXT NOT NULL REFERENCES weekends(start_date) ON DELETE CASCADE,
  clerk_id TEXT NOT NULL REFERENCES players(clerk_id),
  points INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY(weekend_start, clerk_id)
);
CREATE INDEX standings_by_week ON standings(weekend_start, points DESC);
