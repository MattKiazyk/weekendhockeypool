import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, type Game, type Pick, weekendStartAt } from '../src/lib/pool'
import { api } from '../worker/api'
import { auth } from '../worker/auth'
import { getEntry, getWeek, saveEntry, savePlayer, updateLockTime, upsertGame } from '../worker/db'
import { validStart } from '../worker/http'
import { gameFromNhl, resultFromNhl, type NhlGame } from '../worker/nhl'
import { finalize } from '../worker/standings'
import { syncResults, syncSchedule } from '../worker/sync'
import { createTestDatabase } from './helpers/database'

vi.mock('../worker/auth', () => ({ auth: vi.fn() }))

const start = weekendStartAt('2099-10-05T12:00:00Z')
const raw: NhlGame = {
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
}
const games: Game[] = [
  gameFromNhl(raw),
  gameFromNhl({ ...raw, id: 2, startTimeUTC: `${addDays(start, 1)}T23:00:00Z` }),
]
const picks: Pick[] = [
  { gameId: 1, side: 'away', confidence: 2 },
  { gameId: 2, side: 'home', confidence: 1 },
]
const user = { userId: 'player-1', username: 'rinkside' }
let database: ReturnType<typeof createTestDatabase>

beforeEach(async () => {
  database = createTestDatabase()
  vi.mocked(auth).mockResolvedValue(user)
  await database.db
    .prepare('INSERT INTO weekends (start_date, season) VALUES (?, ?)')
    .bind(start, '2099-00')
    .run()
  await database.db.batch([
    ...games.map((game) => upsertGame(database.db, start, game, 'nhl')),
    updateLockTime(database.db, start),
  ])
  await savePlayer(database.db, user)
})
afterEach(() => {
  database.sqlite.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function request(path: string, method = 'GET', body?: unknown) {
  return api(
    new Request(`https://pool.example/api/${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
    { DB: database.db, ADMIN_CLERK_USER_ID: user.userId },
  )
}
function closeEntries() {
  database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z'")
}
function mockSchedule(items: NhlGame[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ gameWeek: [{ date: start, games: items }] })),
  )
}

describe('entry persistence and visibility', () => {
  it('saves and replaces a complete entry without changing its submission time', async () => {
    expect((await request('entry', 'PUT', { startDate: start, picks })).status).toBe(200)
    const first = await getEntry(database.db, start, user.userId)
    const changed = picks.map((pick) => ({ ...pick, confidence: 3 - pick.confidence }))
    await saveEntry(database.db, start, user.userId, changed)
    const saved = await getEntry(database.db, start, user.userId)
    expect(saved?.picks).toEqual(changed)
    expect(saved?.submittedAt).toBe(first?.submittedAt)
    expect(await (await request(`entry?start=${start}`)).json()).toEqual({ entry: saved })
  })

  it('lists entrants before lock but reveals picks only after the deadline to signed-in users', async () => {
    await saveEntry(database.db, start, user.userId, picks)
    expect(await (await request(`entrants?start=${start}`)).json()).toEqual({
      entrants: ['rinkside'],
    })
    expect((await request(`picks?start=${start}`)).status).toBe(403)
    closeEntries()
    const response = await request(`picks?start=${start}`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { picks: unknown[] }).picks).toHaveLength(2)
    vi.mocked(auth).mockResolvedValue(null)
    expect((await request(`picks?start=${start}`)).status).toBe(401)
  })

  it('returns validation details and never stores an incomplete or malformed entry', async () => {
    for (const invalid of [
      [picks[0]],
      [null, null],
      picks.map((pick) => ({ ...pick, confidence: 1 })),
    ]) {
      const response = await request('entry', 'PUT', { startDate: start, picks: invalid })
      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    }
    expect(await getEntry(database.db, start, user.userId)).toBeNull()
  })

  it('enforces the deadline in the API and the database, preserving the existing entry', async () => {
    await saveEntry(database.db, start, user.userId, picks)
    closeEntries()
    expect((await request('entry', 'PUT', { startDate: start, picks })).status).toBe(409)
    await expect(saveEntry(database.db, start, user.userId, picks)).rejects.toThrow(
      'entries are closed',
    )
    expect((await getEntry(database.db, start, user.userId))?.picks).toEqual(picks)
  })

  it('rejects admin mutations by other users', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'someone-else', username: 'someone' })
    expect(
      (await request('admin/remove-game', 'POST', { startDate: start, gameId: 1 })).status,
    ).toBe(403)
    expect((await getWeek(database.db, start))?.games).toHaveLength(2)
  })
})

describe('schedule and results', () => {
  it('keeps manual game details and derives the deadline from the retained schedule', async () => {
    await upsertGame(
      database.db,
      start,
      { ...games[0], startUtc: `${start}T23:30:00Z` },
      'admin',
    ).run()
    mockSchedule([
      raw,
      { ...raw, id: 2, startTimeUTC: games[1].startUtc },
      { ...raw, id: 3, gameType: 1 },
    ])
    const week = await syncSchedule(database.db, start)
    expect(week.games).toHaveLength(2)
    expect(week.games[0].startUtc).toBe(`${start}T23:30:00Z`)
    expect(week.lockAt).toBe(`${start}T23:30:00Z`)
  })

  it('does not restore excluded games or erase a published slate after an empty feed', async () => {
    await request('admin/remove-game', 'POST', { startDate: start, gameId: 1 })
    mockSchedule([raw, { ...raw, id: 2, startTimeUTC: games[1].startUtc }])
    expect((await syncSchedule(database.db, start)).games.map((game) => game.id)).toEqual([2])
    mockSchedule([])
    await expect(syncSchedule(database.db, start)).rejects.toThrow('empty replacement schedule')
    expect((await getWeek(database.db, start))?.games).toHaveLength(1)
  })

  it('freezes the game list at lock without calling the NHL feed', async () => {
    closeEntries()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await syncSchedule(database.db, start)).status).toBe('locked')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps admin corrections during result sync and publishes completed results', async () => {
    await saveEntry(database.db, start, user.userId, picks)
    closeEntries()
    database.sqlite.exec("UPDATE games SET state='void', source='admin' WHERE id=1")
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json({
          games: [
            {
              ...raw,
              gameState: 'FINAL',
              awayTeam: { ...raw.awayTeam, score: 5 },
              homeTeam: { ...raw.homeTeam, score: 2 },
            },
            {
              ...raw,
              id: 2,
              startTimeUTC: games[1].startUtc,
              gameState: 'OFF',
              awayTeam: { ...raw.awayTeam, score: 1 },
              homeTeam: { ...raw.homeTeam, score: 4 },
            },
          ],
        }),
      ),
    )
    const week = await syncResults(database.db, start)
    expect(week?.status).toBe('final')
    expect(week?.games[0].state).toBe('void')
    expect(await (await request(`standings?start=${start}`)).json()).toEqual({
      standings: [{ username: 'rinkside', points: 1, correct: 1, rank: 1 }],
    })
  })

  it('recalculates standings idempotently and excludes entries made incomplete by a schedule change', async () => {
    await saveEntry(database.db, start, user.userId, picks)
    await savePlayer(database.db, { userId: 'player-2', username: 'incomplete' })
    await saveEntry(database.db, start, 'player-2', [picks[0]])
    closeEntries()
    database.sqlite.exec(
      "UPDATE games SET state='final', winner='away', away_score=4, home_score=1",
    )
    await finalize(database.db, start)
    await finalize(database.db, start)
    const rows = database.sqlite.prepare('SELECT clerk_id, points, rank FROM standings').all()
    expect(rows).toEqual([{ clerk_id: user.userId, points: 2, rank: 1 }])
  })

  it('does not finalize empty, unfinished, or pre-deadline weekends', async () => {
    await expect(finalize(database.db, start)).rejects.toThrow('deadline')
    closeEntries()
    await expect(finalize(database.db, start)).rejects.toThrow('Every game')
    database.sqlite.exec('DELETE FROM games')
    await expect(finalize(database.db, start)).rejects.toThrow('Every game')
  })
})

describe('NHL result normalization', () => {
  it('voids postponed games and games moved out of the frozen weekend', () => {
    expect(resultFromNhl({ ...raw, gameScheduleState: 'PPD' }, games[0]).state).toBe('void')
    expect(
      resultFromNhl({ ...raw, startTimeUTC: `${addDays(start, 3)}T23:00:00Z` }, games[0]).state,
    ).toBe('void')
  })

  it('requires unequal final scores before assigning a winner', () => {
    const tied = {
      ...raw,
      gameState: 'FINAL',
      awayTeam: { ...raw.awayTeam, score: 2 },
      homeTeam: { ...raw.homeTeam, score: 2 },
    }
    expect(resultFromNhl(tied, games[0]).winner).toBeNull()
    expect(
      resultFromNhl({ ...tied, homeTeam: { ...tied.homeTeam, score: 3 } }, games[0]),
    ).toMatchObject({ state: 'final', winner: 'home' })
  })

  it('accepts only real Friday dates', () => {
    expect(validStart(start)).toBe(true)
    expect(validStart('2026-02-30')).toBe(false)
    expect(validStart('2026-10-10')).toBe(false)
    expect(validStart(null)).toBe(false)
  })
})
