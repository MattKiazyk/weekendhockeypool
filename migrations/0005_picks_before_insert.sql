CREATE TRIGGER IF NOT EXISTS picks_before_insert BEFORE INSERT ON picks
WHEN NOT EXISTS (
  SELECT 1 FROM entries e JOIN weekends w ON w.start_date=e.weekend_start
  WHERE e.id=NEW.entry_id AND w.status='open' AND julianday(w.lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;
