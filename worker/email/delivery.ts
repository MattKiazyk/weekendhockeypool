import {
  addDays,
  easternDate,
  easternTimeAt,
  isEntryOpen,
  validatePicks,
  weekendStartAt,
  type LeagueId,
} from '../../src/lib/pool'
import { getEntry, getWeek } from '../db'
import type { Env } from '../types'
import { emailLaunch } from './store'
import {
  recapEmail,
  reminderEmail,
  welcomeEmail,
  type EmailContent,
  type RecapPayload,
} from './templates'

interface Job {
  id: string
  clerk_id: string
  kind: 'welcome' | 'reminder' | 'recap'
  league: LeagueId | null
  weekend_start: string | null
  payload: string
  attempts: number
  expires_at: string | null
}
export async function enqueueReminders(env: Env, now: number): Promise<void> {
  const date = easternDate(now)
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  const due = easternTimeAt(date, 9)
  if ((day !== 4 && day !== 5) || now < Date.parse(due)) return
  const rows = await env.DB.prepare(
    "SELECT league, start_date FROM weekends WHERE status='open' AND opens_at <= ? AND lock_at > ?",
  )
    .bind(new Date(now).toISOString(), new Date(now).toISOString())
    .all<{ league: LeagueId; start_date: string }>()
  for (const row of rows.results) {
    if (
      row.league === 'nfl'
        ? day !== 4 || row.start_date !== date
        : day !== 5 || row.start_date !== weekendStartAt(now)
    )
      continue
    const week = await getWeek(env.DB, row.league, row.start_date)
    if (!week?.games.length || !week.lockAt || !isEntryOpen(week, now)) continue
    await env.DB.prepare(
      `INSERT OR IGNORE INTO email_jobs (id, clerk_id, kind, league, weekend_start, payload, created_at, due_at, expires_at)
      SELECT 'reminder:' || ? || ':' || ? || ':' || p.clerk_id, p.clerk_id, 'reminder', ?, ?, '{}', ?, ?, ?
      FROM email_preferences p JOIN email_accounts a ON a.clerk_id=p.clerk_id
      WHERE p.league=? AND p.kind='reminder' AND p.enabled=1 AND p.enabled_at <= ? AND a.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM email_reminder_engagement r
          WHERE r.clerk_id=p.clerk_id AND r.league=p.league AND r.sent_without_entry >= 4)`,
    )
      .bind(
        row.league,
        row.start_date,
        row.league,
        row.start_date,
        new Date(now).toISOString(),
        due,
        week.lockAt,
        row.league,
        due,
      )
      .run()
  }
}
async function contentFor(
  env: Env,
  job: Job,
  now: number,
): Promise<{ content: EmailContent; email: string; deadline?: string } | null> {
  const account = await env.DB.prepare(
    'SELECT email, verified, username, deleted_at FROM email_accounts WHERE clerk_id=?',
  )
    .bind(job.clerk_id)
    .first<{
      email: string | null
      verified: number
      username: string | null
      deleted_at: string | null
    }>()
  if (!account?.email || !account.verified || account.deleted_at) return null
  if (job.kind === 'welcome')
    return { email: account.email, content: welcomeEmail(account.username) }
  const preference = await env.DB.prepare(
    'SELECT enabled, enabled_at FROM email_preferences WHERE clerk_id=? AND league=? AND kind=?',
  )
    .bind(job.clerk_id, job.league, job.kind)
    .first<{ enabled: number; enabled_at: string | null }>()
  if (!preference?.enabled) return null
  const league = job.league!
  const start = job.weekend_start!
  if (job.kind === 'reminder') {
    const engagement = await env.DB.prepare(
      'SELECT sent_without_entry FROM email_reminder_engagement WHERE clerk_id=? AND league=?',
    )
      .bind(job.clerk_id, league)
      .first<{ sent_without_entry: number }>()
    if (engagement && engagement.sent_without_entry >= 4) return null
    const week = await getWeek(env.DB, league, start)
    if (!week?.games.length || !isEntryOpen(week, now)) return null
    const entry = await getEntry(env.DB, league, start, job.clerk_id)
    if (entry && !validatePicks(entry.picks, week.games).length) return null
    return { email: account.email, content: reminderEmail(week), deadline: week.lockAt! }
  }
  const snapshot = await env.DB.prepare(
    'SELECT payload, finalized_at FROM email_recaps WHERE league=? AND weekend_start=?',
  )
    .bind(league, start)
    .first<{ payload: string; finalized_at: string }>()
  if (!snapshot || !preference.enabled_at || preference.enabled_at > snapshot.finalized_at)
    return null
  return {
    email: account.email,
    content: recapEmail(
      JSON.parse(snapshot.payload) as RecapPayload,
      job.clerk_id,
      !!JSON.parse(job.payload).entered,
      league,
      start,
    ),
  }
}
function providerCode(cause: unknown): string | null {
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : null
}
export async function processEmails(env: Env, now = Date.now()): Promise<void> {
  const launch = emailLaunch(env)
  if (!env.EMAIL || env.EMAIL_ENABLED !== 'true' || launch === null || now < launch) return
  const clock = () => Math.max(now, Date.now())
  const timestamp = new Date(now).toISOString()
  // A crash after handing off to the provider is ambiguous: never automatically resend.
  await env.DB.prepare(
    "UPDATE email_jobs SET status='review', last_error='stale_delivery_claim' WHERE status='sending' AND claimed_at < ?",
  )
    .bind(new Date(now - 30 * 60 * 1000).toISOString())
    .run()
  await enqueueReminders(env, now)
  const jobs = await env.DB.prepare(
    "SELECT * FROM email_jobs WHERE status='pending' AND due_at <= ? AND created_at >= ? ORDER BY due_at, id LIMIT 25",
  )
    .bind(timestamp, new Date(launch).toISOString())
    .all<Job>()
  for (const job of jobs.results) {
    const claimed = await env.DB.prepare(
      "UPDATE email_jobs SET status='sending', claimed_at=?, attempts=attempts+1 WHERE id=? AND status='pending' AND due_at <= ?",
    )
      .bind(new Date(clock()).toISOString(), job.id, timestamp)
      .run()
    if (!claimed.meta.changes) continue
    let prepared: Awaited<ReturnType<typeof contentFor>>
    try {
      prepared =
        job.expires_at && Date.parse(job.expires_at) <= clock()
          ? null
          : await contentFor(env, job, clock())
    } catch {
      // No provider call occurred, so this failure is safe to retry.
      await env.DB.prepare(
        "UPDATE email_jobs SET status='pending', due_at=?, last_error='preparation_failed' WHERE id=? AND status='sending'",
      )
        .bind(new Date(now + 15 * 60 * 1000).toISOString(), job.id)
        .run()
      continue
    }
    if (!prepared || (prepared.deadline && Date.parse(prepared.deadline) <= clock())) {
      await env.DB.prepare(
        "UPDATE email_jobs SET status='skipped', last_error='ineligible_at_delivery' WHERE id=? AND status='sending'",
      )
        .bind(job.id)
        .run()
      continue
    }
    let result: EmailSendResult
    try {
      result = await env.EMAIL.send({
        from: { email: 'noreply@weeklypools.ca', name: 'Weekly Pools' },
        to: prepared.email,
        ...prepared.content,
      })
    } catch (cause) {
      const code = providerCode(cause)
      // Only explicit quota rejection establishes that the provider did not accept mail.
      const retry =
        (code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED') && job.attempts < 5
      const rejected =
        code &&
        [
          'E_VALIDATION_ERROR',
          'E_FIELD_MISSING',
          'E_TOO_MANY_RECIPIENTS',
          'E_TOO_MANY_ATTACHMENTS',
          'E_SENDER_NOT_VERIFIED',
          'E_RECIPIENT_NOT_ALLOWED',
          'E_RECIPIENT_SUPPRESSED',
          'E_SENDER_DOMAIN_NOT_AVAILABLE',
          'E_CONTENT_TOO_LARGE',
          'E_HEADER_NOT_ALLOWED',
          'E_HEADER_USE_API_FIELD',
          'E_HEADER_VALUE_INVALID',
          'E_HEADER_VALUE_TOO_LONG',
          'E_HEADER_NAME_INVALID',
          'E_HEADERS_TOO_LARGE',
          'E_HEADERS_TOO_MANY',
        ].includes(code)
      const status = retry
        ? 'pending'
        : rejected || code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED'
          ? 'failed'
          : 'review'
      const retryAt =
        code === 'E_DAILY_LIMIT_EXCEEDED'
          ? easternTimeAt(addDays(easternDate(now), 1), 9)
          : new Date(now + Math.min(240, 15 * 2 ** job.attempts) * 60 * 1000).toISOString()
      await env.DB.prepare(
        "UPDATE email_jobs SET status=?, due_at=?, last_error=? WHERE id=? AND status='sending'",
      )
        .bind(status, retryAt, code ?? 'ambiguous_provider_error', job.id)
        .run()
      if (status === 'review' || status === 'failed')
        console.error('Email delivery needs attention', {
          jobId: job.id,
          code: code ?? 'ambiguous_provider_error',
          status,
        })
      continue
    }
    // A persistence error here leaves the sending claim for manual review, not retry.
    await env.DB.prepare(
      "UPDATE email_jobs SET status='sent', message_id=?, last_error=NULL WHERE id=? AND status='sending'",
    )
      .bind(result.messageId, job.id)
      .run()
  }
}
