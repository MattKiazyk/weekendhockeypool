-- Explicit one-time enablement for existing accounts, without historical sends.
INSERT INTO email_preferences (clerk_id, league, kind, enabled, enabled_at)
SELECT a.clerk_id, l.id, k.kind, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM email_accounts a CROSS JOIN leagues l
CROSS JOIN (SELECT 'reminder' AS kind UNION ALL SELECT 'recap') k
WHERE a.deleted_at IS NULL
ON CONFLICT(clerk_id, league, kind) DO UPDATE SET enabled=1,
  enabled_at=CASE WHEN email_preferences.enabled=1 THEN email_preferences.enabled_at ELSE excluded.enabled_at END;

-- Initialize each account once. Later syncs/sign-ins preserve saved opt-outs.
CREATE TRIGGER email_account_default_preferences AFTER INSERT ON email_accounts
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT OR IGNORE INTO email_preferences (clerk_id, league, kind, enabled, enabled_at)
  SELECT NEW.clerk_id, l.id, k.kind, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM leagues l CROSS JOIN (SELECT 'reminder' AS kind UNION ALL SELECT 'recap') k;
END;
