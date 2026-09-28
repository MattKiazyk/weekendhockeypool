ALTER TABLE weekends ADD COLUMN opens_at TEXT NOT NULL DEFAULT '';

-- The Monday before each Friday uses the post-Sunday Eastern offset.
UPDATE weekends SET opens_at = strftime(
  '%Y-%m-%dT%H:%M:%SZ', start_date, '-4 days',
  CASE WHEN date(start_date, '-4 days') > date(substr(start_date, 1, 4) || '-03-08', 'weekday 0')
    AND date(start_date, '-4 days') < date(substr(start_date, 1, 4) || '-11-01', 'weekday 0')
    THEN '+12 hours' ELSE '+13 hours' END
);

DROP TRIGGER entries_before_insert;
CREATE TRIGGER entries_before_insert BEFORE INSERT ON entries
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(opens_at) <= julianday('now')
  AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;

DROP TRIGGER entries_before_update;
CREATE TRIGGER entries_before_update BEFORE UPDATE ON entries
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE league=NEW.league AND start_date=NEW.weekend_start
  AND status='open' AND julianday(opens_at) <= julianday('now')
  AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;

DROP TRIGGER picks_before_insert;
CREATE TRIGGER picks_before_insert BEFORE INSERT ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w
    ON w.league=e.league AND w.start_date=e.weekend_start
  JOIN games g ON g.id=NEW.game_id AND g.league=e.league AND g.weekend_start=e.weekend_start
  WHERE e.id=NEW.entry_id AND w.status='open'
  AND julianday(w.opens_at) <= julianday('now') AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed or game belongs to another pool');
END;

DROP TRIGGER picks_before_update;
CREATE TRIGGER picks_before_update BEFORE UPDATE ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w
    ON w.league=e.league AND w.start_date=e.weekend_start
  JOIN games g ON g.id=NEW.game_id AND g.league=e.league AND g.weekend_start=e.weekend_start
  WHERE e.id=NEW.entry_id AND w.status='open'
  AND julianday(w.opens_at) <= julianday('now') AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed or game belongs to another pool');
END;
