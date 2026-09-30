import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyEmailPreferences, isEmailPreferences } from '../src/lib/email'
import { addDays, easternTimeAt, weekendStartAt, type LeagueId } from '../src/lib/pool'
import { api } from '../worker/api'
import { auth } from '../worker/auth'
import { getWeek, saveEntry, savePlayer, updateLockTime, upsertGame } from '../worker/db'
import { processEmails } from '../worker/email/delivery'
import {
  nextMorning,
  readSettings,
  saveSettings,
  syncEmailAccount,
  type EmailAccount,
} from '../worker/email/store'
import { recapEmail, welcomeEmail, type RecapRow } from '../worker/email/templates'
import { clerkWebhook } from '../worker/email/webhook'
import { gameFromNhl } from '../worker/nhl'
import { finalize } from '../worker/standings'
import type { Env } from '../worker/types'
import { createTestDatabase } from './helpers/database'

vi.mock('../worker/auth', () => ({ auth: vi.fn() }))
const start = weekendStartAt('2099-10-05T12:00:00Z')
const morning = Date.parse(easternTimeAt(start, 9))
const secret = Buffer.from('a-long-local-test-webhook-signing-key').toString('base64')
const account: EmailAccount = {
  userId: 'user-1',
  username: 'rinkside',
  email: 'rinkside@example.com',
  verified: true,
  createdAt: '2099-09-30T12:00:00.000Z',
  updatedAt: Date.parse('2099-09-30T12:00:00Z'),
}
let database: ReturnType<typeof createTestDatabase>
let env: Env
let send: ReturnType<typeof vi.fn<(message: EmailMessageBuilder) => Promise<EmailSendResult>>>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(morning)
  database = createTestDatabase()
  send = vi.fn(async () => ({ messageId: 'email-1' }))
  env = {
    DB: database.db,
    EMAIL: { send } as SendEmail,
    EMAIL_ENABLED: 'true',
    EMAIL_LAUNCH_AT: '2099-09-01T00:00:00.000Z',
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${secret}`,
  }
  vi.mocked(auth).mockResolvedValue({
    userId: account.userId,
    username: account.username,
    emailAccount: account,
  })
})
afterEach(() => {
  database.sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function subscribe(
  user = account,
  kind: 'reminder' | 'recap' = 'reminder',
  league: LeagueId = 'nhl',
) {
  await syncEmailAccount(env, user)
  await database.db.prepare("UPDATE email_jobs SET status='sent' WHERE kind='welcome'").run()
  const preferences = emptyEmailPreferences()
  preferences[league][kind] = true
  await saveSettings(database.db, user.userId, preferences, Date.now() - 60_000)
}
async function slate(league: LeagueId = 'nhl', date = start) {
  await database.db
    .prepare(
      "INSERT INTO weekends (league, start_date, season, opens_at, week_number) VALUES (?, ?, '2099-00', '2000-01-01T00:00:00.000Z', ?)",
    )
    .bind(league, date, league === 'nfl' ? 5 : null)
    .run()
  const games = [1, 2].map((id) =>
    gameFromNhl({
      id: id + Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000) * 10,
      gameType: 2,
      startTimeUTC: easternTimeAt(addDays(date, id - 1), 19),
      gameState: 'FUT',
      awayTeam: {
        abbrev: 'WPG',
        placeName: { default: 'Winnipeg' },
        commonName: { default: 'Jets' },
      },
      homeTeam: {
        abbrev: 'TOR',
        placeName: { default: 'Toronto' },
        commonName: { default: 'Maple Leafs' },
      },
    }),
  )
  await database.db.batch([
    ...games.map((game) => upsertGame(database.db, league, date, game, 'feed')),
    updateLockTime(database.db, league, date),
  ])
  return (await getWeek(database.db, league, date))!
}
function count(kind: string, status?: string): number {
  return Number(
    database.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM email_jobs WHERE kind=?${status ? ' AND status=?' : ''}`)
      .get(...(status ? [kind, status] : [kind]))!.n,
  )
}
function webhook(type: string, id: string, user = account, eventAt = morning): Request {
  const body = JSON.stringify({
    type,
    timestamp: eventAt,
    data:
      type === 'user.deleted'
        ? { id: user.userId }
        : {
            id: user.userId,
            username: user.username,
            created_at: Date.parse(user.createdAt),
            updated_at: user.updatedAt,
            primary_email_address_id: 'address-1',
            email_addresses: [
              {
                id: 'address-1',
                email_address: user.email,
                verification: { status: user.verified ? 'verified' : 'unverified' },
              },
            ],
          },
  })
  const seconds = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${id}.${seconds}.${body}`)
    .digest('base64')
  return new Request('https://weeklypools.ca/api/webhooks/clerk', {
    method: 'POST',
    body,
    headers: { 'svix-id': id, 'svix-timestamp': seconds, 'svix-signature': `v1,${signature}` },
  })
}

describe('email accounts and settings', () => {
  it('defaults all switches off and rejects malformed or extra input', async () => {
    await syncEmailAccount(env, account)
    expect((await readSettings(env.DB, account.userId)).preferences).toEqual(
      emptyEmailPreferences(),
    )
    expect(isEmailPreferences(emptyEmailPreferences())).toBe(true)
    expect(isEmailPreferences({ ...emptyEmailPreferences(), clerk_id: 'another-user' })).toBe(false)
    expect(isEmailPreferences({ nhl: { reminder: true, recap: 'yes' } })).toBe(false)
  })
  it('authenticates settings, saves only the caller, and keeps activation time on repeated saves', async () => {
    const request = (method: string, body?: unknown) =>
      api(
        new Request('https://weeklypools.ca/api/email-settings', {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
      )
    vi.mocked(auth).mockResolvedValueOnce(null)
    expect((await request('GET')).status).toBe(401)
    const preferences = emptyEmailPreferences()
    preferences.nfl.recap = true
    expect((await request('PUT', preferences)).status).toBe(200)
    const before = database.sqlite
      .prepare('SELECT enabled_at FROM email_preferences WHERE enabled=1')
      .get()!.enabled_at
    vi.setSystemTime(morning + 60_000)
    await request('PUT', preferences)
    expect(
      database.sqlite.prepare('SELECT enabled_at FROM email_preferences WHERE enabled=1').get()!
        .enabled_at,
    ).toBe(before)
    expect((await request('PUT', { ...preferences, clerk_id: 'user-2' })).status).toBe(400)
    expect((await request('GET')).status).toBe(200)
    expect((await readSettings(env.DB, 'user-2')).preferences.nfl.recap).toBe(false)
    const me = await api(new Request('https://weeklypools.ca/api/me'), env)
    expect(await me.json()).not.toHaveProperty('email')
  })
  it('sends welcome once only for new accounts after verification, without requiring a username', async () => {
    await syncEmailAccount(env, { ...account, verified: false, username: null })
    expect(count('welcome')).toBe(0)
    await syncEmailAccount(env, { ...account, username: null, updatedAt: account.updatedAt + 1 })
    await syncEmailAccount(env, { ...account, username: null, updatedAt: account.updatedAt + 1 })
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].subject).toBe('Welcome to Weekly Pools!')
    await processEmails(env, morning)
    await syncEmailAccount(env, {
      ...account,
      userId: 'old-user',
      createdAt: '2090-01-01T00:00:00.000Z',
    })
    expect(count('welcome')).toBe(1)
  })
  it('requires an explicit launch and enable switch', async () => {
    await syncEmailAccount({ ...env, EMAIL_LAUNCH_AT: '' }, account)
    expect(count('welcome')).toBe(0)
    await syncEmailAccount(env, account)
    await processEmails({ ...env, EMAIL_ENABLED: 'false' }, morning)
    expect(send).not.toHaveBeenCalled()
    await processEmails({ ...env, EMAIL_LAUNCH_AT: '' }, morning)
    await processEmails({ ...env, EMAIL_LAUNCH_AT: '2099' }, morning)
    await processEmails({ ...env, EMAIL_LAUNCH_AT: '2099-02-31T00:00:00Z' }, morning)
    expect(send).not.toHaveBeenCalled()
  })
  it('verifies real webhook signatures, deduplicates events and prevents stale updates or resurrection', async () => {
    expect(
      (
        await clerkWebhook(
          new Request('https://weeklypools.ca/api/webhooks/clerk', { method: 'POST', body: '{}' }),
          env,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await clerkWebhook(
          webhook('user.updated', 'evt-new', {
            ...account,
            email: 'new@example.com',
            updatedAt: morning,
          }),
          env,
        )
      ).status,
    ).toBe(200)
    await clerkWebhook(webhook('user.created', 'evt-old', account, morning - 1000), env)
    await clerkWebhook(
      webhook('user.updated', 'evt-new', {
        ...account,
        email: 'new@example.com',
        updatedAt: morning,
      }),
      env,
    )
    expect((await readSettings(env.DB, account.userId)).email).toBe('new@example.com')
    expect(count('welcome')).toBe(1)
    await clerkWebhook(webhook('user.deleted', 'evt-delete'), env)
    await clerkWebhook(
      webhook('user.created', 'evt-late', { ...account, updatedAt: morning + 1000 }),
      env,
    )
    await syncEmailAccount(env, { ...account, updatedAt: morning + 2000 })
    expect((await readSettings(env.DB, account.userId)).email).toBeNull()
    await processEmails(env, morning)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('email schedules and standings snapshots', () => {
  it('stops after four sent reminders per league and resets only for a complete entry', async () => {
    await subscribe()
    await savePlayer(env.DB, { userId: account.userId, username: account.username })
    for (let i = 0; i < 4; i++) {
      const date = addDays(start, i * 7)
      const now = Date.parse(easternTimeAt(date, 9))
      vi.setSystemTime(now)
      await slate('nhl', date)
      await processEmails(env, now)
    }
    expect(send).toHaveBeenCalledTimes(4)
    const engagement = () =>
      database.sqlite
        .prepare("SELECT * FROM email_reminder_engagement WHERE clerk_id=? AND league='nhl'")
        .get(account.userId)!
    expect(engagement().sent_without_entry).toBe(4)
    expect(engagement().suppressed_at).toBeTruthy()
    // Replaying the successful status cannot count it again.
    await env.DB.prepare("UPDATE email_jobs SET status='sent' WHERE kind='reminder'").run()
    expect(engagement().sent_without_entry).toBe(4)
    const date = addDays(start, 28)
    vi.setSystemTime(Date.parse(easternTimeAt(date, 9)))
    const week = await slate('nhl', date)
    await processEmails(env)
    expect(send).toHaveBeenCalledTimes(4)
    // Even an already queued job must be suppressed immediately before delivery.
    await env.DB.prepare(
      `INSERT INTO email_jobs
      (id, clerk_id, kind, league, weekend_start, payload, created_at, due_at)
      VALUES ('queued', ?, 'reminder', 'nhl', ?, '{}', ?, ?)`,
    )
      .bind(account.userId, date, new Date().toISOString(), new Date().toISOString())
      .run()
    await processEmails(env)
    expect(send).toHaveBeenCalledTimes(4)
    await saveEntry(env.DB, 'nhl', date, account.userId, [
      { gameId: week.games[0].id, side: 'away', confidence: 1 },
    ])
    expect(engagement().sent_without_entry).toBe(4)
    await saveEntry(
      env.DB,
      'nhl',
      date,
      account.userId,
      week.games.map((game, i) => ({ gameId: game.id, side: 'away', confidence: i + 1 })),
    )
    expect(engagement().sent_without_entry).toBe(0)
    expect(engagement().suppressed_at).toBeNull()
    const next = addDays(date, 7)
    vi.setSystemTime(Date.parse(easternTimeAt(next, 9)))
    await slate('nhl', next)
    await processEmails(env)
    expect(send).toHaveBeenCalledTimes(5)
    expect(engagement().sent_without_entry).toBe(1)
  })
  it('keeps league counters separate and does not count rejected or ambiguous sends', async () => {
    await subscribe()
    await env.DB.prepare(
      `INSERT INTO email_reminder_engagement
      (clerk_id, league, sent_without_entry, suppressed_at) VALUES (?, 'nfl', 4, ?)`,
    )
      .bind(account.userId, new Date().toISOString())
      .run()
    await slate()
    send.mockRejectedValueOnce({ code: 'E_RATE_LIMIT_EXCEEDED' })
    await processEmails(env)
    expect(
      database.sqlite.prepare('SELECT COUNT(*) AS n FROM email_reminder_engagement').get()!.n,
    ).toBe(1)
    vi.advanceTimersByTime(16 * 60 * 1000)
    send.mockRejectedValueOnce(new Error('unknown outcome'))
    await processEmails(env)
    expect(
      database.sqlite.prepare('SELECT COUNT(*) AS n FROM email_reminder_engagement').get()!.n,
    ).toBe(1)
    expect(count('reminder', 'review')).toBe(1)
  })
  it('uses Eastern mornings across daylight saving and strictly the next morning after finalization', () => {
    expect(nextMorning(Date.parse('2026-10-31T14:00:00Z'))).toBe('2026-11-01T14:00:00.000Z')
    expect(nextMorning(Date.parse('2026-03-07T15:00:00Z'))).toBe('2026-03-08T13:00:00.000Z')
    expect(nextMorning(Date.parse('2026-10-02T12:59:00Z'))).toBe('2026-10-02T13:00:00.000Z')
    expect(nextMorning(Date.parse('2026-10-02T13:00:00Z'))).toBe('2026-10-03T13:00:00.000Z')
  })
  it('sends a reminder once at or after 9, only for an incomplete open entry', async () => {
    await subscribe()
    await slate()
    await processEmails(env, morning - 1)
    expect(send).not.toHaveBeenCalled()
    await processEmails(env, morning)
    await processEmails(env, morning + 15 * 60_000)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].text).toContain(`league=nhl&start=${start}#picks`)
    expect(count('reminder', 'sent')).toBe(1)
  })
  it('suppresses complete entries but reminds users with incomplete entries', async () => {
    await subscribe()
    const week = await slate()
    await savePlayer(env.DB, { userId: account.userId, username: account.username })
    await saveEntry(
      env.DB,
      'nhl',
      start,
      account.userId,
      week.games.map((game, i) => ({ gameId: game.id, side: 'away', confidence: i + 1 })),
    )
    const second = { ...account, userId: 'user-2', email: 'second@example.com' }
    await subscribe(second)
    await savePlayer(env.DB, { userId: second.userId, username: 'second' })
    await saveEntry(env.DB, 'nhl', start, second.userId, [
      { gameId: week.games[0].id, side: 'away', confidence: 1 },
    ])
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].to).toBe(second.email)
    expect(count('reminder', 'skipped')).toBe(1)
  })
  it('skips empty, unopened, locked and wrong-day slates', async () => {
    await subscribe()
    await slate()
    await env.DB.prepare('UPDATE weekends SET opens_at=?').bind(easternTimeAt(start, 10)).run()
    await processEmails(env, morning)
    expect(count('reminder')).toBe(0)
    await env.DB.prepare("UPDATE weekends SET opens_at='2000-01-01T00:00:00.000Z'").run()
    await processEmails(env, Date.parse(easternTimeAt(addDays(start, 1), 9)))
    await processEmails(env, Date.parse(easternTimeAt(start, 20)))
    expect(send).not.toHaveBeenCalled()
    await env.DB.prepare('DELETE FROM games').run()
    await processEmails(env, morning)
    expect(count('reminder')).toBe(0)
  })
  it('schedules NFL on Thursday and PWHL on Friday with separate league jobs', async () => {
    const thursday = addDays(start, -1)
    vi.setSystemTime(Date.parse(easternTimeAt(thursday, 9)))
    await subscribe(account, 'reminder', 'nfl')
    await slate('nfl', thursday)
    await processEmails(env, Date.parse(easternTimeAt(thursday, 9)))
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].subject).toContain('Week 5')
    vi.setSystemTime(morning)
    await subscribe(account, 'reminder', 'pwhl')
    await slate('pwhl')
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].subject).toContain('PWHL')
  })
  it('atomically snapshots recap recipients and standings; excludes later opt-ins and never resends corrections', async () => {
    await subscribe(account, 'recap')
    const week = await slate()
    await savePlayer(env.DB, { userId: account.userId, username: account.username })
    await saveEntry(
      env.DB,
      'nhl',
      start,
      account.userId,
      week.games.map((game, i) => ({ gameId: game.id, side: 'away', confidence: i + 1 })),
    )
    await subscribe({ ...account, userId: 'spectator', email: 'spectator@example.com' }, 'recap')
    await env.DB.prepare("UPDATE games SET state='final', winner='away'").run()
    const finalized = Date.parse(easternTimeAt(addDays(start, 3), 2))
    vi.setSystemTime(finalized)
    await finalize(env.DB, 'nhl', start)
    expect(count('recap')).toBe(2)
    await subscribe({ ...account, userId: 'late-user' }, 'recap')
    await env.DB.prepare("UPDATE games SET winner='home'").run()
    await finalize(env.DB, 'nhl', start)
    expect(count('recap')).toBe(2)
    await processEmails(env, finalized)
    expect(send).not.toHaveBeenCalled()
    await processEmails(env, Date.parse(nextMorning(finalized)))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.find(([mail]) => mail.to === account.email)![0].text).toContain(
      '3 points',
    )
    expect(send.mock.calls.some(([mail]) => mail.text?.includes('didn’t enter'))).toBe(true)
    await processEmails(env, Date.parse(nextMorning(finalized)) + 60_000)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('excludes opt-ins after finalization and suppresses recap opt-outs before delivery', async () => {
    await subscribe(account, 'recap')
    await slate()
    await env.DB.prepare("UPDATE games SET state='void'").run()
    const finalized = Date.parse(easternTimeAt(addDays(start, 3), 2))
    const late = { ...account, userId: 'late', email: 'late@example.com' }
    await syncEmailAccount(env, late)
    await env.DB.prepare("UPDATE email_jobs SET status='sent' WHERE kind='welcome'").run()
    const preferences = emptyEmailPreferences()
    preferences.nhl.recap = true
    await saveSettings(env.DB, late.userId, preferences, finalized + 1)
    vi.setSystemTime(finalized)
    await finalize(env.DB, 'nhl', start)
    expect(count('recap')).toBe(1)
    await saveSettings(env.DB, account.userId, emptyEmailPreferences(), finalized + 1)
    await processEmails(env, Date.parse(nextMorning(finalized)))
    expect(send).not.toHaveBeenCalled()
    expect(count('recap', 'skipped')).toBe(1)
  })

  it('does not backfill a recap when an already-final historical week is corrected', async () => {
    await subscribe(account, 'recap')
    await slate()
    await env.DB.prepare("UPDATE games SET state='void'").run()
    await env.DB.prepare(
      "UPDATE weekends SET status='final', finalized_at='2090-01-01T00:00:00.000Z'",
    ).run()
    vi.setSystemTime(Date.parse(easternTimeAt(addDays(start, 3), 2)))
    await finalize(env.DB, 'nhl', start)
    expect(count('recap')).toBe(0)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM email_recaps').get()!.n).toBe(0)
  })

  it('rolls back the snapshot and jobs if standings publication fails', async () => {
    await subscribe(account, 'recap')
    await slate()
    await env.DB.prepare("UPDATE games SET state='void'").run()
    vi.setSystemTime(Date.parse(easternTimeAt(addDays(start, 3), 2)))
    database.sqlite.exec(
      "CREATE TRIGGER reject_final BEFORE UPDATE ON weekends WHEN NEW.status='final' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    await expect(finalize(env.DB, 'nhl', start)).rejects.toThrow('test failure')
    expect(count('recap')).toBe(0)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM email_recaps').get()!.n).toBe(0)
  })
})

describe('safe email delivery and templates', () => {
  it('claims jobs atomically under overlapping runs', async () => {
    await syncEmailAccount(env, account)
    await Promise.all([processEmails(env, morning), processEmails(env, morning)])
    expect(send).toHaveBeenCalledOnce()
    expect(count('welcome', 'sent')).toBe(1)
  })
  it('rechecks opt-out, verification and first-game deadline on retry', async () => {
    await subscribe()
    await slate()
    send.mockRejectedValueOnce({ code: 'E_RATE_LIMIT_EXCEEDED' })
    await processEmails(env, morning)
    expect(count('reminder', 'pending')).toBe(1)
    await saveSettings(env.DB, account.userId, emptyEmailPreferences(), morning + 1)
    await processEmails(env, morning + 15 * 60_000)
    expect(send).toHaveBeenCalledOnce()
    expect(count('reminder', 'skipped')).toBe(1)
    await syncEmailAccount(env, { ...account, userId: 'unverified', verified: true })
    await syncEmailAccount(env, {
      ...account,
      userId: 'unverified',
      verified: false,
      updatedAt: account.updatedAt + 1,
    })
    await processEmails(env, morning)
    expect(count('welcome', 'skipped')).toBe(1)
  })
  it('expires rate-limited reminders before another send after lock', async () => {
    await subscribe()
    await slate()
    send.mockRejectedValueOnce({ code: 'E_RATE_LIMIT_EXCEEDED' })
    await processEmails(env, morning)
    await processEmails(env, Date.parse(easternTimeAt(start, 20)))
    expect(send).toHaveBeenCalledOnce()
    expect(count('reminder', 'skipped')).toBe(1)
  })
  it('retries quota rejection but marks unknown outcomes and abandoned claims for review', async () => {
    await syncEmailAccount(env, account)
    send.mockRejectedValueOnce({ code: 'E_RATE_LIMIT_EXCEEDED' })
    await processEmails(env, morning)
    await processEmails(env, morning + 14 * 60_000)
    expect(send).toHaveBeenCalledOnce()
    await processEmails(env, morning + 15 * 60_000)
    expect(send).toHaveBeenCalledTimes(2)
    await syncEmailAccount(env, { ...account, userId: 'ambiguous' })
    send.mockRejectedValueOnce(new Error('timeout'))
    await processEmails(env, morning)
    expect(count('welcome', 'review')).toBe(1)
    await processEmails(env, morning + 60 * 60_000)
    expect(send).toHaveBeenCalledTimes(3)
    await syncEmailAccount(env, { ...account, userId: 'crashed' })
    await env.DB.prepare(
      "UPDATE email_jobs SET status='sending', claimed_at=? WHERE clerk_id='crashed'",
    )
      .bind(new Date(morning - 31 * 60_000).toISOString())
      .run()
    await processEmails(env, morning)
    expect(count('welcome', 'review')).toBe(2)
  })
  it('checks the current clock between deliveries so a slow batch cannot send past lock', async () => {
    await subscribe()
    await subscribe({ ...account, userId: 'user-2', email: 'second@example.com' })
    await slate()
    send.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.parse(easternTimeAt(start, 20)))
      return { messageId: 'email-1' }
    })
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledOnce()
    expect(count('reminder', 'skipped')).toBe(1)
  })

  it('does not resend after provider acceptance followed by a database failure', async () => {
    await syncEmailAccount(env, account)
    const prepare = env.DB.prepare.bind(env.DB)
    const failure = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes("status='sent', message_id")) {
        statement.run = async () => {
          throw new Error('write unavailable')
        }
      }
      return statement
    })
    await expect(processEmails(env, morning)).rejects.toThrow('write unavailable')
    failure.mockRestore()
    expect(count('welcome', 'sending')).toBe(1)
    await processEmails(env, morning + 31 * 60_000)
    expect(count('welcome', 'review')).toBe(1)
    expect(send).toHaveBeenCalledOnce()
  })

  it('bounds delivery batches and resumes pending jobs without duplicates', async () => {
    for (let i = 0; i < 27; i++) await syncEmailAccount(env, { ...account, userId: `batch-${i}` })
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledTimes(25)
    expect(count('welcome', 'pending')).toBe(2)
    await processEmails(env, morning + 15 * 60_000)
    expect(send).toHaveBeenCalledTimes(27)
    expect(count('welcome', 'pending')).toBe(0)
  })

  it('uses a changed verified primary address and restores an undelivered welcome after reverification', async () => {
    await syncEmailAccount(env, account)
    await syncEmailAccount(env, { ...account, verified: false, updatedAt: account.updatedAt + 1 })
    await processEmails(env, morning)
    expect(count('welcome', 'skipped')).toBe(1)
    await syncEmailAccount(env, {
      ...account,
      email: 'replacement@example.com',
      updatedAt: account.updatedAt + 2,
    })
    await processEmails(env, morning)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].to).toBe('replacement@example.com')
  })

  it('renders tenth-place ties and a personalized lower rank without exposing IDs; escapes HTML', () => {
    const standings: RecapRow[] = Array.from({ length: 13 }, (_, i) => ({
      clerkId: `user-${i}`,
      username: i === 12 ? '<script>&"' : `Player ${i}`,
      rank: i === 10 ? 10 : i + 1,
      points: 100 - i,
      correct: 5,
    }))
    const recap = recapEmail({ title: 'NHL weekend', standings }, 'user-12', true, 'nhl', start)
    expect(recap.html).toContain('Player 10')
    expect(recap.html).not.toContain('Player 11')
    expect(recap.html).toContain('&lt;script&gt;&amp;&quot;')
    expect(recap.html).not.toContain('<script>')
    expect(recap.html).not.toContain('user-12')
    expect(recap.text).toContain('rank 13')
    expect(recap.text).toContain('Email Settings: https://weeklypools.ca/#email-settings')
    expect(welcomeEmail(null).text).toContain('no betting, money, or prizes')
    expect(welcomeEmail(null).text).toContain('one-time account welcome')
    expect(
      recapEmail({ title: 'NHL', standings: [] }, 'invalid', true, 'nhl', start).text,
    ).toContain('incomplete at lock')
  })
})
