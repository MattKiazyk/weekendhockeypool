-- Email addresses are private account data, independent of public players/usernames.
CREATE TABLE email_accounts (
  clerk_id TEXT PRIMARY KEY,
  email TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  username TEXT,
  created_at TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL,
  source_event_at INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE TABLE email_preferences (
  clerk_id TEXT NOT NULL REFERENCES email_accounts(clerk_id),
  league TEXT NOT NULL REFERENCES leagues(id),
  kind TEXT NOT NULL CHECK (kind IN ('reminder', 'recap')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_at TEXT,
  PRIMARY KEY (clerk_id, league, kind)
);
CREATE TABLE email_webhooks (
  event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
CREATE TABLE email_recaps (
  league TEXT NOT NULL REFERENCES leagues(id),
  weekend_start TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (league, weekend_start)
);
CREATE TABLE email_jobs (
  id TEXT PRIMARY KEY,
  clerk_id TEXT NOT NULL REFERENCES email_accounts(clerk_id),
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'reminder', 'recap')),
  league TEXT REFERENCES leagues(id),
  weekend_start TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  message_id TEXT,
  last_error TEXT
);
CREATE INDEX email_jobs_due ON email_jobs(status, due_at);
CREATE INDEX email_preferences_subscribers ON email_preferences(league, kind, enabled);
