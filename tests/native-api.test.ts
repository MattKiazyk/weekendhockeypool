import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { nativeAuth } from '../worker/auth'
import { nativeApi, nativeRoutes } from '../worker/native/api'
import { finalize } from '../worker/standings'
import { keyDigest, keyOwner } from '../worker/native/store'
import worker from '../worker/index'
import { getEntry, getWeek, upsertGame, updateLockTime } from '../worker/db'
import { gameFromNhl } from '../worker/nhl'
import { addDays, weekendStartAt, type Pick } from '../src/lib/pool'
import { emptyEmailPreferences } from '../src/lib/email'
import type { Env, Player } from '../worker/types'
import { createTestDatabase } from './helpers/database'

vi.mock('../worker/auth', () => ({ auth: vi.fn(), nativeAuth: vi.fn() }))
const admin: Player = { userId: 'user_admin', username: 'rinkside' }
const other: Player = { userId: 'user_other', username: 'visitor' }
let database: ReturnType<typeof createTestDatabase>
let env: Env
let secret: string
let keyId: string
const start = weekendStartAt('2099-10-05T12:00:00Z')
const game = gameFromNhl({
  id: 1,
  gameType: 2,
  startTimeUTC: `${start}T23:00:00Z`,
  gameState: 'FUT',
  awayTeam: { abbrev: 'WPG', placeName: { default: 'Winnipeg' }, commonName: { default: 'Jets' } },
  homeTeam: {
    abbrev: 'TOR',
    placeName: { default: 'Toronto' },
    commonName: { default: 'Maple Leafs' },
  },
})
const picks: Pick[] = [{ gameId: 1, side: 'away', confidence: 1 }]
const limiter = () => ({ limit: vi.fn().mockResolvedValue({ success: true }) })

const contract = YAML.parse(readFileSync('docs/api/openapi.yaml', 'utf8'))
const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
ajv.addSchema(contract, 'native')
function conforms(response: Response, path: string, method = 'get') {
  const operation = contract.paths[path][method]
  const schema = response.ok
    ? operation.responses[String(response.status)].content['application/json'].schema
    : contract.components.responses.ApiError.content['application/json'].schema
  const validate = ajv.getSchema(`native${schema.$ref}`)!
  return response
    .clone()
    .json()
    .then((body) => {
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
    })
}
function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://api.weeklypools.ca/v1/${path}`, {
    method,
    headers: {
      'x-api-key': secret,
      authorization: 'Bearer test-session',
      'cf-connecting-ip': '192.0.2.1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return nativeApi(req(path, method, body, headers), env)
}
async function issue(label = 'My phone') {
  const response = await call('keys', 'POST', { label })
  expect(response.status).toBe(201)
  await conforms(response, '/keys', 'post')
  return (await response.json()) as { key: { id: string; label: string }; secret: string }
}

beforeEach(async () => {
  database = createTestDatabase()
  env = {
    DB: database.db,
    ADMIN_CLERK_USER_ID: admin.userId,
    API_IP_LIMIT: limiter(),
    API_READ_LIMIT: limiter(),
    API_WRITE_LIMIT: limiter(),
    API_KEY_LIMIT: limiter(),
  }
  vi.mocked(nativeAuth).mockResolvedValue(admin)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('Tests must not contact feeds or Clerk')),
  )
  // Provisioning does not require an existing key.
  secret = ''
  const issued = await issue()
  secret = issued.secret
  keyId = issued.key.id
  await env.DB.prepare(
    'INSERT INTO weekends (league, start_date, season, opens_at) VALUES (?, ?, ?, ?)',
  )
    .bind('nhl', start, '2099-00', '2000-01-01T00:00:00Z')
    .run()
  await env.DB.batch([
    upsertGame(env.DB, 'nhl', start, game, 'feed'),
    updateLockTime(env.DB, 'nhl', start),
  ])
})
afterEach(() => {
  database.sqlite.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device keys and approval', () => {
  it('stores only a digest and exposes secrets only when created or rotated', async () => {
    const row = database.sqlite.prepare('SELECT * FROM api_keys').get()!
    expect(row.digest).toBe(await keyDigest(secret))
    expect(JSON.stringify(row)).not.toContain(secret)
    const listing = await call('keys')
    await conforms(listing, '/keys')
    expect(JSON.stringify(await listing.json())).not.toContain(secret)
    expect(await keyOwner(env, secret)).toBe(admin.userId)
  })
  it('requires approval for provisioning and allows admin approval and removal', async () => {
    vi.mocked(nativeAuth).mockResolvedValue(other)
    expect((await call('keys', 'POST', { label: 'Other phone' })).status).toBe(403)
    expect((await call('admin/approvals')).status).toBe(403)
    vi.mocked(nativeAuth).mockResolvedValue(admin)
    const approved = await call(`admin/approvals/${other.userId}`, 'PUT', {})
    await conforms(approved, '/admin/approvals/{userId}', 'put')
    const listing = await call('admin/approvals')
    await conforms(listing, '/admin/approvals')
    vi.mocked(nativeAuth).mockResolvedValue(other)
    const issued = await issue('Other phone')
    expect(await keyOwner(env, issued.secret)).toBe(other.userId)
    expect((await call(`keys/${keyId}`, 'DELETE')).status).toBe(404)
    expect((await call(`keys/${keyId}/rotate`, 'POST', {})).status).toBe(404)
    vi.mocked(nativeAuth).mockResolvedValue(admin)
    expect((await call(`admin/approvals/${admin.userId}`, 'DELETE')).status).toBe(409)
    await call(`admin/approvals/${other.userId}`, 'DELETE')
    await expect(keyOwner(env, issued.secret)).rejects.toMatchObject({ status: 401 })
    await call(`admin/approvals/${other.userId}`, 'PUT', {})
    await expect(keyOwner(env, issued.secret)).rejects.toMatchObject({ status: 401 })
    vi.mocked(nativeAuth).mockResolvedValue(other)
    expect((await issue()).secret).not.toBe(issued.secret)
  })
  it('rolls back approval removal if key revocation fails', async () => {
    await call(`admin/approvals/${other.userId}`, 'PUT', {})
    vi.mocked(nativeAuth).mockResolvedValue(other)
    const issued = await issue()
    vi.mocked(nativeAuth).mockResolvedValue(admin)
    database.sqlite.exec(
      "CREATE TRIGGER fail_revoke BEFORE UPDATE OF revoked_at ON api_keys BEGIN SELECT RAISE(ABORT, 'private failure'); END",
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(`admin/approvals/${other.userId}`, 'DELETE')).status).toBe(500)
    expect(await keyOwner(env, issued.secret)).toBe(other.userId)
  })
  it('rotates atomically and permits only one winner among concurrent rotations', async () => {
    const results = await Promise.all([
      call(`keys/${keyId}/rotate`, 'POST', {}),
      call(`keys/${keyId}/rotate`, 'POST', {}),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = results.find((r) => r.ok)!
    await conforms(winner, '/keys/{id}/rotate', 'post')
    const next = (await winner.json()) as { secret: string }
    await expect(keyOwner(env, secret)).rejects.toMatchObject({ status: 401 })
    expect(await keyOwner(env, next.secret)).toBe(admin.userId)
    await call(`keys/${keyId}`, 'DELETE')
    await expect(keyOwner(env, next.secret)).rejects.toMatchObject({ status: 401 })
    expect((await call(`keys/${keyId}/rotate`, 'POST', {})).status).toBe(404)
    expect((await call(`keys/${keyId}`, 'DELETE')).status).toBe(200)
  })
  it('blocks key-only reads after a Clerk deletion webhook tombstone', async () => {
    database.sqlite
      .prepare(
        'INSERT INTO email_accounts (clerk_id,created_at,source_updated_at,deleted_at) VALUES (?,?,?,?)',
      )
      .run(admin.userId, '2020-01-01T00:00:00Z', 1, '2026-09-30T00:00:00Z')
    expect((await call('leagues')).status).toBe(401)
  })
  it('admin revokes all keys without removing approval', async () => {
    await issue('Second device')
    const response = await call(`admin/users/${admin.userId}/keys`, 'DELETE')
    await conforms(response, '/admin/users/{userId}/keys', 'delete')
    await expect(keyOwner(env, secret)).rejects.toMatchObject({ status: 401 })
    expect((await issue()).secret).toBeTruthy()
  })
  it.each(['', '   ', 'a'.repeat(101), 42, null])(
    'rejects invalid device labels: %s',
    async (label) => {
      expect((await call('keys', 'POST', { label })).status).toBe(400)
    },
  )
})

describe('protected shared pool handlers', () => {
  it('allows key-only reads but requires matching Clerk sessions for personal routes', async () => {
    vi.mocked(nativeAuth).mockResolvedValue(null)
    const response = await call('leagues', 'GET', undefined, { authorization: '' })
    expect(response.status).toBe(200)
    await conforms(response, '/leagues')
    for (const path of [
      'me',
      `entry?start=${start}`,
      `picks?start=${start}`,
      'email-settings',
      'keys',
    ])
      expect((await call(path)).status).toBe(401)
    vi.mocked(nativeAuth).mockResolvedValue(other)
    expect((await call('me')).status).toBe(403)
    vi.mocked(nativeAuth).mockResolvedValue(admin)
    const me = await call('me')
    await conforms(me, '/me')
  })
  it('rejects missing, revoked, and query-only keys', async () => {
    expect((await call('leagues', 'GET', undefined, { 'x-api-key': '' })).status).toBe(401)
    expect(
      (await call(`leagues?api_key=${secret}`, 'GET', undefined, { 'x-api-key': '' })).status,
    ).toBe(401)
    await call(`keys/${keyId}`, 'DELETE')
    expect((await call('leagues')).status).toBe(401)
  })
  it('saves and reloads picks, preserves privacy, and enforces opening/deadline rules', async () => {
    const saved = await call('entry', 'PUT', { league: 'nhl', startDate: start, picks })
    expect(saved.status).toBe(200)
    await conforms(saved, '/entry', 'put')
    const entry = await call(`entry?start=${start}`)
    await conforms(entry, '/entry')
    expect((await getEntry(env.DB, 'nhl', start, admin.userId))?.picks).toEqual(picks)
    expect((await call(`picks?start=${start}`)).status).toBe(403)
    database.sqlite.exec("UPDATE weekends SET opens_at='2199-01-01T00:00:00Z'")
    expect((await call('entry', 'PUT', { startDate: start, picks })).status).toBe(409)
    database.sqlite.exec(
      "UPDATE weekends SET opens_at='2000-01-01T00:00:00Z', lock_at='2000-01-01T00:00:00Z'",
    )
    expect((await call('entry', 'PUT', { startDate: start, picks })).status).toBe(409)
    expect((await getEntry(env.DB, 'nhl', start, admin.userId))?.picks).toEqual(picks)
    const revealed = await call(`picks?start=${start}`)
    await conforms(revealed, '/picks')
  })
  it('preserves the previous entry when the database catches a deadline race', async () => {
    await call('entry', 'PUT', { startDate: start, picks })
    const before = await getEntry(env.DB, 'nhl', start, admin.userId)
    const batch = env.DB.batch.bind(env.DB)
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async (statements) => {
      database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z'")
      return batch(statements)
    })
    const response = await call('entry', 'PUT', {
      startDate: start,
      picks: [{ ...picks[0], side: 'home' }],
    })
    expect(response.status).toBe(409)
    await conforms(response, '/entry', 'put')
    expect(await getEntry(env.DB, 'nhl', start, admin.userId)).toEqual(before)
  })
  it('conforms to standings schemas with finalized results and combined totals', async () => {
    await call('entry', 'PUT', { startDate: start, picks })
    database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z'")
    database.sqlite.exec(
      "UPDATE games SET state='final', winner='away', away_score=3, home_score=1",
    )
    await finalize(env.DB, 'nhl', start)
    const weekly = await call(`standings?start=${start}`)
    await conforms(weekly, '/standings')
    expect(await weekly.json()).toHaveProperty('standings.0.points', 1)
    await conforms(await call('season?season=2099-00'), '/season')
    await conforms(await call('season?season=2099-00&league=all'), '/season')
  })
  it('returns documented listings and rejects malformed picks without changing saved data', async () => {
    for (const [path, schema] of [
      [`week?start=${start}`, '/week'],
      ['weeks', '/weeks'],
      ['open-leagues', '/open-leagues'],
      [`entrants?start=${start}`, '/entrants'],
      [`standings?start=${start}`, '/standings'],
      ['season?season=2099-00&league=all', '/season'],
    ]) {
      const response = await call(path)
      expect(response.status).toBe(200)
      await conforms(response, schema)
    }
    for (const invalid of [
      null,
      [],
      [null],
      [{ ...picks[0], confidence: '1' }],
      [{ ...picks[0], gameId: 999 }],
      [{ ...picks[0], extra: true }],
    ])
      expect((await call('entry', 'PUT', { startDate: start, picks: invalid })).status).toBe(400)
    expect(await getEntry(env.DB, 'nhl', start, admin.userId)).toBeNull()
  })
  it('shares league-scoped saves and returns games and records for NHL, PWHL, and NFL', async () => {
    for (const league of ['nhl', 'pwhl', 'nfl'] as const) {
      const selected = league === 'nfl' ? addDays(start, -1) : start
      if (league !== 'nhl') {
        await env.DB.prepare(
          'INSERT INTO weekends (league,start_date,season,opens_at,week_number) VALUES (?,?,?,?,?)',
        )
          .bind(league, selected, '2099-00', '2000-01-01T00:00:00Z', league === 'nfl' ? 4 : null)
          .run()
        await env.DB.batch([
          upsertGame(env.DB, league, selected, game, 'feed'),
          updateLockTime(env.DB, league, selected),
        ])
      }
      const week = (await getWeek(env.DB, league, selected))!
      const chosen = [{ gameId: week.games[0].id, side: 'home', confidence: 1 }]
      const response = await call('entry', 'PUT', { league, startDate: selected, picks: chosen })
      expect(response.status).toBe(200)
      const sheet = await call(`week?league=${league}&start=${selected}`)
      await conforms(sheet, '/week')
      expect((await getEntry(env.DB, league, selected, admin.userId))?.picks).toEqual(chosen)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('exposes private email only to its matching account and saves preferences', async () => {
    vi.mocked(nativeAuth).mockResolvedValue({
      ...admin,
      emailAccount: {
        userId: admin.userId,
        username: admin.username,
        email: 'private@example.com',
        verified: true,
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: 1,
      },
    })
    const response = await call('email-settings')
    await conforms(response, '/email-settings')
    expect(await response.json()).toHaveProperty('email', 'private@example.com')
    const preferences = emptyEmailPreferences()
    preferences.nfl.recap = true
    const saved = await call('email-settings', 'PUT', preferences)
    await conforms(saved, '/email-settings', 'put')
    expect(await saved.json()).toHaveProperty('preferences', preferences)
    expect(await (await call(`entrants?start=${start}`)).text()).not.toContain(
      'private@example.com',
    )
    vi.mocked(nativeAuth).mockResolvedValue(other)
    expect((await call('email-settings')).status).toBe(403)
  })
})

describe('request protection and routing', () => {
  it.each(['API_IP_LIMIT', 'API_READ_LIMIT', 'API_WRITE_LIMIT', 'API_KEY_LIMIT'] as const)(
    'enforces %s and fails closed',
    async (name) => {
      const isWrite = name === 'API_WRITE_LIMIT'
      const path = isWrite ? 'entry' : name === 'API_KEY_LIMIT' ? 'keys' : 'leagues'
      const method = isWrite ? 'PUT' : 'GET'
      const body = isWrite ? { startDate: start, picks } : undefined
      vi.mocked(env[name]!.limit).mockResolvedValue({ success: false })
      const response = await call(path, method, body)
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('60')
      await conforms(response, isWrite ? '/entry' : `/${path}`, method.toLowerCase())
      vi.mocked(env[name]!.limit).mockRejectedValue(new Error('binding failure'))
      expect((await call(path, method, body)).status).toBe(503)
      delete env[name]
      expect((await call(path, method, body)).status).toBe(503)
    },
  )
  it('aggregates user limits across device keys and limits before expensive work', async () => {
    const second = await issue('Laptop')
    await call('leagues')
    await call('leagues', 'GET', undefined, { 'x-api-key': second.secret })
    expect(vi.mocked(env.API_READ_LIMIT!.limit).mock.calls.slice(-2)).toEqual([
      [{ key: admin.userId }],
      [{ key: admin.userId }],
    ])
    vi.mocked(nativeAuth).mockClear()
    vi.mocked(env.API_IP_LIMIT!.limit).mockResolvedValue({ success: false })
    expect((await call('keys')).status).toBe(429)
    expect(nativeAuth).not.toHaveBeenCalled()
  })
  it('returns secure JSON for unknown routes and unsupported methods', async () => {
    const response = await call('leagues', 'POST', {})
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    for (const header of ['x-request-id', 'x-content-type-options', 'cache-control'])
      expect(response.headers.get(header)).toBeTruthy()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toHaveProperty(
      'error.requestId',
      response.headers.get('x-request-id'),
    )
    expect((await call('admin/remove-game', 'POST', {})).status).toBe(404)
    expect((await call('leagues', 'OPTIONS')).status).toBe(405)
  })
  it('rejects malformed JSON, media types, invalid UTF-8, and oversized streamed bodies', async () => {
    for (const body of ['{', 'null', '[]']) {
      const request = new Request('https://api.weeklypools.ca/v1/keys', {
        method: 'POST',
        headers: { authorization: 'Bearer test-session', 'content-type': 'application/json' },
        body,
      })
      expect((await nativeApi(request, env)).status).toBe(400)
    }
    expect(
      (await call('keys', 'POST', { label: 'Phone' }, { 'content-type': 'text/plain' })).status,
    ).toBe(415)
    expect((await call('keys', 'POST', { label: 'x'.repeat(65536) })).status).toBe(413)
    expect(
      (await call('keys', 'POST', { label: 'Phone' }, { 'content-length': '65537' })).status,
    ).toBe(413)
    const request = new Request('https://api.weeklypools.ca/v1/keys', {
      method: 'POST',
      headers: { authorization: 'Bearer test-session', 'content-type': 'application/json' },
      body: new Uint8Array([0xff]),
    })
    expect((await nativeApi(request, env)).status).toBe(400)
  })
  it('sanitizes unexpected errors and logs no exception details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('secret SQL private@example.com')
    })
    const response = await call('leagues')
    expect(response.status).toBe(500)
    await conforms(response, '/leagues')
    expect(await response.text()).not.toContain('secret SQL')
    expect(JSON.stringify(log.mock.calls)).not.toContain('private@example.com')
    const website = await worker.fetch(new Request('https://weeklypools.ca/api/weeks'), env)
    expect(website.status).toBe(500)
    expect(await website.text()).not.toContain('secret SQL')
  })
  it('never serves website assets or legacy routes on the API hostname', async () => {
    env.ASSETS = {
      fetch: vi.fn().mockResolvedValue(new Response('<html>website</html>')),
    } as unknown as Fetcher
    for (const path of [
      '/',
      '/index.html',
      '/api/week',
      '/api/webhooks/clerk',
      '/api/admin/remove-game',
    ]) {
      const response = await worker.fetch(
        new Request(`https://api.weeklypools.ca${path}`, {
          headers: { 'sec-fetch-mode': 'navigate' },
        }),
        env,
      )
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
    }
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
    expect((await worker.fetch(new Request('https://weeklypools.ca/'), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://weeklypools.ca/v1/leagues'), env)).status).toBe(
      200,
    )
    // The website's SPA fallback is not native API access.
    expect((await worker.fetch(req('leagues'), env)).status).toBe(200)
    expect(
      (
        await worker.fetch(
          new Request('http://127.0.0.1:5173/v1/leagues', { headers: { 'x-api-key': secret } }),
          env,
        )
      ).status,
    ).toBe(200)
  })
  it('keeps route methods synchronized with OpenAPI', () => {
    const paths = Object.fromEntries(
      Object.entries(contract.paths).map(([path, item]) => [
        `/v1${path}`,
        Object.keys(item as object)
          .map((method) => method.toUpperCase())
          .sort(),
      ]),
    )
    expect(paths).toEqual(
      Object.fromEntries(
        Object.entries(nativeRoutes).map(([path, methods]) => [path, [...methods].sort()]),
      ),
    )
  })
})
