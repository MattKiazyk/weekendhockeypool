import {
  defaultEmailPreferences,
  type EmailSettings,
  type EmailPreferences,
} from '../../src/lib/email'
import { leagues } from '../../src/lib/leagues'
import { addDays, easternDate, easternTimeAt, type Weekend } from '../../src/lib/pool'
import type { Env } from '../types'
import { weekTitle, type RecapRow } from './templates'
import { createClerkClient } from '@clerk/backend'

export interface EmailAccount {
  userId: string
  email: string | null
  verified: boolean
  username: string | null
  createdAt: string
  updatedAt: number
  eventAt?: number
}
export function accountFromClerk(user: {
  id: string
  username: string | null
  createdAt: number
  updatedAt: number
  primaryEmailAddressId: string | null
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[]
}): EmailAccount {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
  return {
    userId: user.id,
    username: user.username,
    email: primary?.emailAddress ?? null,
    verified: primary?.verification?.status === 'verified',
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: user.updatedAt,
    eventAt: Date.now(),
  }
}
export function emailLaunch(env: Env): number | null {
  const value = env.EMAIL_LAUNCH_AT ?? ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null
  const time = Date.parse(value)
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z')
  return Number.isFinite(time) && new Date(time).toISOString() === normalized ? time : null
}
export function nextMorning(now: number): string {
  const date = easternDate(now)
  const today = easternTimeAt(date, 9)
  return Date.parse(today) > now ? today : easternTimeAt(addDays(date, 1), 9)
}
export function accountStatement(db: D1Database, account: EmailAccount): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_accounts (clerk_id, email, verified, username, created_at, source_updated_at, source_event_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clerk_id) DO UPDATE SET email=excluded.email, verified=excluded.verified,
      username=excluded.username, source_updated_at=excluded.source_updated_at, source_event_at=excluded.source_event_at
    WHERE email_accounts.deleted_at IS NULL AND (excluded.source_updated_at > email_accounts.source_updated_at
      OR (excluded.source_updated_at = email_accounts.source_updated_at AND excluded.source_event_at >= email_accounts.source_event_at))`,
    )
    .bind(
      account.userId,
      account.email,
      Number(account.verified),
      account.username,
      account.createdAt,
      account.updatedAt,
      account.eventAt ?? 0,
    )
}
export function welcomeStatement(env: Env, userId: string, now = Date.now()): D1PreparedStatement {
  const launch = emailLaunch(env)
  const timestamp = new Date(now).toISOString()
  return env.DB.prepare(
    `INSERT INTO email_jobs (id, clerk_id, kind, payload, created_at, due_at)
    SELECT 'welcome:' || clerk_id, clerk_id, 'welcome', '{}', ?, ? FROM email_accounts
    WHERE clerk_id=? AND verified=1 AND email IS NOT NULL AND deleted_at IS NULL AND created_at >= ?
    ON CONFLICT(id) DO UPDATE SET status='pending', due_at=excluded.due_at, last_error=NULL
    WHERE email_jobs.status='skipped' AND email_jobs.last_error='ineligible_at_delivery'`,
  ).bind(
    timestamp,
    timestamp,
    userId,
    launch === null ? '9999-12-31T00:00:00.000Z' : new Date(launch).toISOString(),
  )
}
export async function syncEmailAccount(env: Env, account: EmailAccount): Promise<void> {
  await env.DB.batch([accountStatement(env.DB, account), welcomeStatement(env, account.userId)])
}
// Older players may predate email account tracking. Fetch real Clerk metadata;
// never infer an address or account creation time from public player records.
export async function syncExistingEmailAccounts(env: Env): Promise<void> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) return
  const missing = await env.DB.prepare(
    `SELECT p.clerk_id FROM players p LEFT JOIN email_accounts a ON a.clerk_id=p.clerk_id
      WHERE a.clerk_id IS NULL ORDER BY p.clerk_id LIMIT 25`,
  ).all<{ clerk_id: string }>()
  if (!missing.results.length) return
  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
  for (const player of missing.results) {
    try {
      const user = await client.users.getUser(player.clerk_id)
      await syncEmailAccount(env, accountFromClerk(user))
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 404) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO email_accounts
          (clerk_id, created_at, source_updated_at, deleted_at) VALUES (?, ?, 0, ?)`,
        )
          .bind(player.clerk_id, new Date().toISOString(), new Date().toISOString())
          .run()
      } else {
        console.error('Existing email account synchronization failed')
      }
    }
  }
}
export async function readSettings(db: D1Database, userId: string): Promise<EmailSettings> {
  const account = await db
    .prepare('SELECT email, verified FROM email_accounts WHERE clerk_id=? AND deleted_at IS NULL')
    .bind(userId)
    .first<{ email: string | null; verified: number }>()
  const rows = await db
    .prepare('SELECT league, kind, enabled FROM email_preferences WHERE clerk_id=?')
    .bind(userId)
    .all<{ league: keyof EmailPreferences; kind: 'reminder' | 'recap'; enabled: number }>()
  const preferences = defaultEmailPreferences()
  for (const row of rows.results) preferences[row.league][row.kind] = !!row.enabled
  return { email: account?.email ?? null, verified: !!account?.verified, preferences }
}
export async function saveSettings(
  db: D1Database,
  userId: string,
  preferences: EmailPreferences,
  now = Date.now(),
): Promise<void> {
  const timestamp = new Date(now).toISOString()
  await db.batch(
    leagues.flatMap(({ id }) =>
      (['reminder', 'recap'] as const).map((kind) =>
        db
          .prepare(
            `INSERT INTO email_preferences (clerk_id, league, kind, enabled, enabled_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(clerk_id, league, kind) DO UPDATE SET enabled=excluded.enabled,
      enabled_at=CASE WHEN excluded.enabled=0 THEN NULL WHEN email_preferences.enabled=1 THEN email_preferences.enabled_at ELSE excluded.enabled_at END`,
          )
          .bind(
            userId,
            id,
            kind,
            Number(preferences[id][kind]),
            preferences[id][kind] ? timestamp : null,
          ),
      ),
    ),
  )
}
// Append after pick replacement so incomplete writes never reset reminder fatigue.
export function resetReminderStatement(
  db: D1Database,
  league: string,
  start: string,
  userId: string,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_reminder_engagement
    (clerk_id, league, sent_without_entry, last_complete_entry_at, suppressed_at)
    SELECT ?, ?, 0, ?, NULL WHERE EXISTS (
      SELECT 1 FROM entries e WHERE e.clerk_id=? AND e.league=? AND e.weekend_start=?
        AND (SELECT COUNT(*) FROM games WHERE league=e.league AND weekend_start=e.weekend_start) > 0
        AND (SELECT COUNT(*) FROM picks WHERE entry_id=e.id) =
          (SELECT COUNT(*) FROM games WHERE league=e.league AND weekend_start=e.weekend_start)
        AND NOT EXISTS (SELECT 1 FROM picks p JOIN games g ON g.id=p.game_id
          WHERE p.entry_id=e.id AND (g.league!=e.league OR g.weekend_start!=e.weekend_start
            OR p.confidence > (SELECT COUNT(*) FROM games WHERE league=e.league AND weekend_start=e.weekend_start)))
    ) ON CONFLICT(clerk_id, league) DO UPDATE SET sent_without_entry=0,
      last_complete_entry_at=excluded.last_complete_entry_at, suppressed_at=NULL`,
    )
    .bind(userId, league, timestamp, userId, league, start)
}
// All statements are appended to the standings publication batch. The snapshot is
// inserted last, so later recalculations cannot enqueue new recipients.
export function recapStatements(
  db: D1Database,
  week: Weekend,
  standings: RecapRow[],
  finalizedAt: string,
): D1PreparedStatement[] {
  if (week.status === 'final') return []
  const due = nextMorning(Date.parse(finalizedAt))
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO email_jobs (id, clerk_id, kind, league, weekend_start, payload, created_at, due_at)
      SELECT 'recap:' || ? || ':' || ? || ':' || p.clerk_id, p.clerk_id, 'recap', ?, ?,
        json_object('entered', EXISTS(SELECT 1 FROM entries e WHERE e.clerk_id=p.clerk_id AND e.league=? AND e.weekend_start=?)), ?, ?
      FROM email_preferences p JOIN email_accounts a ON a.clerk_id=p.clerk_id
      WHERE p.league=? AND p.kind='recap' AND p.enabled=1 AND p.enabled_at <= ? AND a.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM email_recaps WHERE league=? AND weekend_start=?)`,
      )
      .bind(
        week.league,
        week.startDate,
        week.league,
        week.startDate,
        week.league,
        week.startDate,
        finalizedAt,
        due,
        week.league,
        finalizedAt,
        week.league,
        week.startDate,
      ),
    db
      .prepare(
        'INSERT OR IGNORE INTO email_recaps (league, weekend_start, finalized_at, due_at, payload) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        week.league,
        week.startDate,
        finalizedAt,
        due,
        JSON.stringify({ title: weekTitle(week), standings }),
      ),
  ]
}
