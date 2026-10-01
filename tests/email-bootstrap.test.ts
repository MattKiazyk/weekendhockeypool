import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyEmailPreferences } from '../src/lib/email'
import { readSettings, saveSettings, syncExistingEmailAccounts } from '../worker/email/store'
import type { Env } from '../worker/types'
import { createTestDatabase } from './helpers/database'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser } }) }))
let database: ReturnType<typeof createTestDatabase>
let env: Env
beforeEach(() => {
  database = createTestDatabase()
  env = {
    DB: database.db,
    CLERK_SECRET_KEY: 'test-secret',
    CLERK_PUBLISHABLE_KEY: 'test-publishable',
    EMAIL_LAUNCH_AT: '2026-09-30T15:47:59.333Z',
  }
  getUser.mockReset()
  getUser.mockImplementation(async (id: string) => ({
    id,
    username: id,
    createdAt: Date.parse('2020-01-01T00:00:00Z'),
    updatedAt: Date.parse('2026-10-01T00:00:00Z'),
    primaryEmailAddressId: 'primary',
    emailAddresses: [
      { id: 'primary', emailAddress: `${id}@example.com`, verification: { status: 'verified' } },
    ],
  }))
})
afterEach(() => database.sqlite.close())
function player(id: string) {
  database.sqlite
    .prepare(
      "INSERT INTO players (clerk_id, username, updated_at) VALUES (?, ?, '2026-10-01T00:00:00Z')",
    )
    .run(id, id)
}
it('initializes existing players from Clerk without historical welcomes or overwriting opt-outs', async () => {
  player('older')
  await syncExistingEmailAccounts(env)
  const settings = await readSettings(env.DB, 'older')
  expect(settings.verified).toBe(true)
  expect(
    Object.values(settings.preferences).every((league) => league.reminder && league.recap),
  ).toBe(true)
  expect(database.sqlite.prepare('SELECT count(*) AS count FROM email_jobs').get()?.count).toBe(0)
  await saveSettings(env.DB, 'older', emptyEmailPreferences())
  await syncExistingEmailAccounts(env)
  expect(getUser).toHaveBeenCalledTimes(1)
  expect((await readSettings(env.DB, 'older')).preferences).toEqual(emptyEmailPreferences())
})
it('bounds each account synchronization batch to 25', async () => {
  for (let i = 0; i < 26; i++) player(`player-${i}`)
  await syncExistingEmailAccounts(env)
  expect(getUser).toHaveBeenCalledTimes(25)
  await syncExistingEmailAccounts(env)
  expect(getUser).toHaveBeenCalledTimes(26)
})
it('suppresses deleted users and retries transient account lookup failures', async () => {
  player('deleted')
  player('transient')
  getUser.mockImplementation(async (id: string) => {
    throw { status: id === 'deleted' ? 404 : 503 }
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await syncExistingEmailAccounts(env)
    expect(
      database.sqlite
        .prepare("SELECT deleted_at FROM email_accounts WHERE clerk_id='deleted'")
        .get()?.deleted_at,
    ).toBeTruthy()
    expect(
      database.sqlite.prepare('SELECT count(*) AS count FROM email_preferences').get()?.count,
    ).toBe(0)
    expect(
      database.sqlite
        .prepare("SELECT clerk_id FROM email_accounts WHERE clerk_id='transient'")
        .get(),
    ).toBeUndefined()
    await syncExistingEmailAccounts(env)
    expect(getUser.mock.calls.map(([id]) => id)).toEqual(['deleted', 'transient', 'transient'])
  } finally {
    log.mockRestore()
  }
})
