-- Native API approvals are independent of website access. The configured admin is
-- implicitly approved; removing another user's approval also revokes their keys.
CREATE TABLE api_approvals (
  clerk_id TEXT PRIMARY KEY,
  approved_at TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  clerk_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  digest TEXT NOT NULL UNIQUE CHECK (length(digest) = 64),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_keys_owner ON api_keys(clerk_id);
