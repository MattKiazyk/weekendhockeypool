-- Private per-league reminder fatigue and future re-engagement eligibility.
CREATE TABLE email_reminder_engagement (
  clerk_id TEXT NOT NULL,
  league TEXT NOT NULL REFERENCES leagues(id),
  sent_without_entry INTEGER NOT NULL DEFAULT 0 CHECK (sent_without_entry >= 0),
  last_complete_entry_at TEXT,
  suppressed_at TEXT,
  PRIMARY KEY (clerk_id, league)
);
CREATE INDEX email_reminder_reengagement ON email_reminder_engagement(suppressed_at);

-- Count confirmed provider acceptance atomically with the delivery record, once.
CREATE TRIGGER email_reminder_sent AFTER UPDATE OF status ON email_jobs
WHEN NEW.kind='reminder' AND NEW.status='sent' AND OLD.status!='sent'
BEGIN
  INSERT INTO email_reminder_engagement (clerk_id, league, sent_without_entry, suppressed_at)
  VALUES (NEW.clerk_id, NEW.league, 1, NULL)
  ON CONFLICT(clerk_id, league) DO UPDATE SET
    sent_without_entry=sent_without_entry+1,
    suppressed_at=CASE WHEN sent_without_entry+1 >= 4
      THEN COALESCE(suppressed_at, NEW.claimed_at) ELSE suppressed_at END
  WHERE last_complete_entry_at IS NULL OR NEW.claimed_at > last_complete_entry_at;
END;
