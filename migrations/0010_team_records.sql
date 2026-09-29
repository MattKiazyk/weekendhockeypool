CREATE TABLE team_records (
  league TEXT NOT NULL,
  weekend_start TEXT NOT NULL,
  team_code TEXT NOT NULL,
  record TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (league, weekend_start, team_code),
  FOREIGN KEY (league, weekend_start) REFERENCES weekends(league, start_date) ON DELETE CASCADE
);

CREATE TRIGGER team_records_before_insert BEFORE INSERT ON team_records
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'team records are locked');
END;

CREATE TRIGGER team_records_before_update BEFORE UPDATE ON team_records
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'team records are locked');
END;
