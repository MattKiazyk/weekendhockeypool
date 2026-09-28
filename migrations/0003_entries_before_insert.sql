CREATE TRIGGER IF NOT EXISTS entries_before_insert BEFORE INSERT ON entries
WHEN NOT EXISTS (
  SELECT 1 FROM weekends WHERE start_date=NEW.weekend_start AND status='open'
  AND julianday(lock_at) > julianday('now')
)
BEGIN
  SELECT RAISE(ABORT, 'entries are closed');
END;
