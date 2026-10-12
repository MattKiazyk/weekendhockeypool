INSERT INTO leagues (id) VALUES ('cfl');

-- Initialize only the new league. Existing league opt-outs remain untouched.
INSERT OR IGNORE INTO email_preferences (clerk_id, league, kind, enabled, enabled_at)
SELECT a.clerk_id, 'cfl', k.kind, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM email_accounts a
CROSS JOIN (SELECT 'reminder' AS kind UNION ALL SELECT 'recap') k
WHERE a.deleted_at IS NULL;
