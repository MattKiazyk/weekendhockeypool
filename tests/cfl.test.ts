import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  cflFixtures,
  cflWeekContext,
  getCflRecords,
  getCflResults,
  getCflSchedule,
  resultFromCfl,
  type CflFixture,
} from '../worker/cfl'
import { api } from '../worker/api'
import { admin } from '../worker/admin'
import { getEntry, getWeek, saveEntry, savePlayer, updateLockTime, upsertGame } from '../worker/db'
import { scheduled, syncResults, syncSchedule, syncTeamRecords } from '../worker/sync'
import { leagueSeasonFor } from '../src/lib/leagues'
import { createTestDatabase } from './helpers/database'

const start = '2026-06-04'
const opener: CflFixture = {
  ID: 1,
  season_id: 75,
  week: 1,
  game_type_id: 1,
  start_at: '2026-06-04T19:00:00-04:00',
  home_team_id: 20,
  away_team_id: 19,
}
const monday: CflFixture = { ...opener, ID: 2, start_at: '2026-06-08T19:00:00-04:00' }
const next: CflFixture = { ...opener, ID: 3, week: 2, start_at: '2026-06-12T19:00:00-04:00' }
const teams = [
  {
    ID: 20,
    name: 'Blue Bombers',
    region_label: 'Winnipeg',
    abbreviation: 'WPG',
    logo_svg: 'data:image/svg+xml,%3Csvg/%3E',
  },
  { ID: 19, name: 'Argonauts', region_label: 'Toronto', abbreviation: 'TOR' },
]
let database: ReturnType<typeof createTestDatabase>
let games: CflFixture[]
let detail: CflFixture | null
let records: unknown
function mockFeed() {
  const feed = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/seasons')
      return Response.json([
        { ID: 34, year: 2025 },
        { ID: 75, year: 2026 },
      ])
    if (url.pathname === '/api/teams') return Response.json(teams)
    if (url.pathname === '/api/standings/2026') return Response.json(records)
    if (url.pathname === '/api/seasons/75/fixtures') {
      const page = Number(url.searchParams.get('page')) || 1
      return Response.json(games.slice((page - 1) * 100, page * 100))
    }
    if (url.pathname.startsWith('/api/fixtures/') && detail) return Response.json(detail)
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', feed)
  return feed
}
beforeEach(() => {
  database = createTestDatabase()
  games = [
    opener,
    monday,
    next,
    { ...opener, ID: 4, game_type_id: 0 },
    { ...opener, ID: 5, game_type_id: 6 },
  ]
  detail = null
  records = {
    data: {
      divisions: {
        unified: {
          standings: teams.map((team) => ({
            abbreviation: team.abbreviation,
            wins: 2,
            losses: 1,
            ties: 0,
          })),
        },
      },
    },
  }
  mockFeed()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-02T12:01:00Z'))
})
afterEach(() => {
  database.sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function request(path: string, method = 'GET', body?: unknown) {
  return api(
    new Request(`https://pool.example/api/${path}`, {
      method,
      ...(body
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
    { DB: database.db },
    { userId: 'fan', username: 'cfl_only' },
  )
}
async function enteredWeek() {
  const week = (await syncSchedule(database.db, 'cfl', start))!
  await savePlayer(database.db, { userId: 'fan', username: 'cfl_only' })
  database.sqlite.exec(
    "UPDATE weekends SET opens_at='2000-01-01T00:00:00Z', lock_at='2099-01-01T00:00:00Z' WHERE league='cfl'",
  )
  const picks = week.games.map((game, index) => ({
    gameId: game.id,
    side: 'away' as const,
    confidence: index + 1,
  }))
  await saveEntry(database.db, 'cfl', start, 'fan', picks)
  return { week, picks }
}
it('discovers season IDs and includes official Monday games with offset-aware times', async () => {
  const schedule = await getCflSchedule(start)
  expect(schedule).toMatchObject({
    season: '2026-27',
    weekNumber: 1,
    opensAt: '2026-06-02T12:00:00.000Z',
  })
  expect(schedule.games.map((game) => game.sourceId)).toEqual([1, 2])
  expect(schedule.games[0]).toMatchObject({
    startUtc: '2026-06-04T23:00:00.000Z',
    home: { code: 'WPG' },
    away: { code: 'TOR' },
  })
  expect(schedule.games[1].easternDate).toBe('2026-06-08')
  expect(leagueSeasonFor('cfl', '2026-06-04')).toBe('2026-27')
  expect(leagueSeasonFor('nhl', '2026-06-04')).toBe('2025-26')
  expect(leagueSeasonFor('nfl', '2027-01-07')).toBe('2026-27')
})
it.each([
  ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/svg+xml;base64,PHN2Zy8+'],
  ['data:image/svg+xml;charset%3DUS-ASCII;base64,PHN2Zy8+', 'data:image/svg+xml;base64,PHN2Zy8+'],
  ['data:image/svg+xml;charset%3DUS-ASCII,%3Csvg/%3E', 'data:image/svg+xml,%3Csvg/%3E'],
])('preserves logo payload encoding while fixing feed headers: %s', async (logo, expected) => {
  const feed = mockFeed()
  vi.stubGlobal('fetch', async (input: string | URL) => {
    if (new URL(String(input)).pathname === '/api/teams')
      return Response.json(teams.map((team) => ({ ...team, logo_svg: logo })))
    return feed(input)
  })
  const schedule = await getCflSchedule(start)
  expect(schedule.games[0].home.logo).toBe(expected)
  expect(schedule.games[0].away.logo).toBe(expected)
})
it('changes numbered weeks exactly Tuesday at 8 a.m. Eastern and ends after the last week', async () => {
  expect(await cflWeekContext(Date.parse('2026-06-02T11:59:59Z'))).toMatchObject({
    active: null,
    next: { number: 1 },
    offseason: true,
  })
  expect((await cflWeekContext(Date.parse('2026-06-09T11:59:59Z'))).active?.number).toBe(1)
  expect((await cflWeekContext(Date.parse('2026-06-09T12:00:00Z'))).active).toMatchObject({
    number: 2,
    startDate: '2026-06-11',
  })
  expect((await cflWeekContext(Date.parse('2026-06-16T12:00:00Z'))).offseason).toBe(true)
  games.push({ ...opener, ID: 8, week: 23, start_at: '2026-11-06T19:00:00-05:00' })
  expect((await cflWeekContext(Date.parse('2026-11-03T13:00:00Z'))).active).toMatchObject({
    number: 23,
    opensAt: '2026-11-03T13:00:00.000Z',
  })
})
it('fetches all pages and rejects duplicate or unbounded pages', async () => {
  games = Array.from({ length: 101 }, (_, i) => ({ ...opener, ID: i + 1 }))
  const feed = mockFeed()
  expect(await cflFixtures(75)).toHaveLength(101)
  expect(feed.mock.calls.map(([url]) => String(url))).toContain(
    'https://echo.pims.cfl.ca/api/seasons/75/fixtures?limit=100&page=2',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(games.slice(0, 100))),
  )
  await expect(cflFixtures(75)).rejects.toThrow('page')
  let counter = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(Array.from({ length: 100 }, () => ({ ...opener, ID: ++counter }))),
    ),
  )
  await expect(cflFixtures(75)).rejects.toThrow('pagination exceeded')
})
it('rejects invalid feeds, offset-free kickoffs, and unknown teams', async () => {
  games[0] = { ...opener, start_at: '2026-06-04T19:00:00' }
  await expect(getCflSchedule(start)).rejects.toThrow('fixture is invalid')
  games[0] = { ...opener, home_team_id: 99 }
  await expect(getCflSchedule(start)).rejects.toThrow('team is missing')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  )
  await expect(getCflSchedule(start)).rejects.toThrow('503')
})
it('keeps persisted week keys when the feed changes the first week kickoff', async () => {
  await syncSchedule(database.db, 'cfl', start)
  games = games.map((game) =>
    game.week === 1 ? { ...game, start_at: '2026-06-12T19:00:00-04:00' } : game,
  )
  expect((await getCflSchedule(start, database.db)).weekNumber).toBe(1)
  expect(
    (await cflWeekContext(Date.parse('2026-06-09T12:00:00Z'), database.db)).active?.startDate,
  ).toBe('2026-06-11')
})
it('normalizes live, final, tie, moved, and cancelled games without guessing unknown results', () => {
  expect(resultFromCfl(opener, 1, 75)?.state).toBe('scheduled')
  expect(
    resultFromCfl(
      { ...opener, game_status: 'In Progress', home_team_score: 7, away_team_score: 0 },
      1,
      75,
    )?.state,
  ).toBe('live')
  const finished = { ...opener, game_status: 'Finished', home_team_score: 24, away_team_score: 21 }
  expect(resultFromCfl(finished, 1, 75)).toMatchObject({
    state: 'final',
    winner: 'home',
    homeScore: 24,
  })
  expect(resultFromCfl({ ...finished, away_team_score: 24 }, 1, 75)?.state).toBe('void')
  expect(resultFromCfl({ ...finished, week: 2 }, 1, 75)?.state).toBe('void')
  expect(resultFromCfl({ ...finished, season_id: 34 }, 1, 75)?.state).toBe('void')
  expect(resultFromCfl({ ...opener, game_status: 'Postponed' }, 1, 75)?.state).toBe('void')
  expect(resultFromCfl({ ...opener, game_status: 'Mystery' }, 1, 75)).toBeNull()
  expect(resultFromCfl({ ...finished, home_team_score: null }, 1, 75)).toBeNull()
})
it('uses individual fixture fallback for moved games and retries missing results', async () => {
  const week = (await syncSchedule(database.db, 'cfl', start))!
  games = games.filter((game) => game.ID !== opener.ID)
  detail = { ...opener, game_type_id: 6 }
  expect((await getCflResults(week)).get(1)?.state).toBe('void')
  detail = null
  expect((await getCflResults(week)).has(1)).toBe(false)
})
it('hides unreleased weeks, rejects pre-opening writes in API and database, and reveals only after lock', async () => {
  const { week, picks } = await enteredWeek()
  database.sqlite.exec("UPDATE weekends SET opens_at='2099-01-01T00:00:00Z' WHERE league='cfl'")
  expect(await (await request(`week?league=cfl&start=${start}`)).json()).toMatchObject({
    week: null,
    cflOffseason: false,
  })
  expect(await (await request('weeks?league=cfl')).json()).toEqual({ weeks: [] })
  expect((await request('entry', 'PUT', { league: 'cfl', startDate: start, picks })).status).toBe(
    409,
  )
  await expect(saveEntry(database.db, 'cfl', start, 'fan', picks)).rejects.toThrow(
    'entries are closed',
  )
  database.sqlite.exec("UPDATE weekends SET opens_at='2000-01-01T00:00:00Z' WHERE league='cfl'")
  expect((await request(`picks?league=cfl&start=${start}`)).status).toBe(403)
  // A status label alone cannot reveal picks.
  database.sqlite.exec("UPDATE weekends SET status='locked' WHERE league='cfl'")
  expect((await request(`picks?league=cfl&start=${start}`)).status).toBe(403)
  database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='cfl'")
  expect(await (await request(`picks?league=cfl&start=${start}`)).json()).toHaveProperty(
    'picks',
    expect.arrayContaining([expect.objectContaining({ game_id: week.games[0].id })]),
  )
  expect((await request('entry', 'PUT', { league: 'cfl', startDate: start, picks })).status).toBe(
    409,
  )
  await expect(saveEntry(database.db, 'cfl', start, 'fan', picks)).rejects.toThrow(
    'entries are closed',
  )
})
it('preserves entries after failed atomic replacement and isolates overlapping source IDs', async () => {
  const { week, picks } = await enteredWeek()
  await expect(
    saveEntry(database.db, 'cfl', start, 'fan', [{ ...picks[0], gameId: 999999 }]),
  ).rejects.toThrow()
  expect((await getEntry(database.db, 'cfl', start, 'fan'))?.picks).toEqual(picks)
  const nflStart = start
  await database.db
    .prepare('INSERT INTO weekends (league, start_date, season, opens_at) VALUES (?, ?, ?, ?)')
    .bind('nfl', nflStart, '2026-27', '2000-01-01T00:00:00Z')
    .run()
  await upsertGame(database.db, 'nfl', nflStart, week.games[0], 'feed').run()
  expect((await getWeek(database.db, 'nfl', nflStart))?.games[0].id).not.toBe(week.games[0].id)
  expect(await getEntry(database.db, 'nfl', nflStart, 'fan')).toBeNull()
})
it('retains manual overrides and exclusions, rejects empty refreshes, and freezes locked slates', async () => {
  const week = (await syncSchedule(database.db, 'cfl', start))!
  const manual = { ...week.games[0], startUtc: '2026-06-05T00:00:00Z' }
  await upsertGame(database.db, 'cfl', start, manual, 'admin').run()
  await database.db.batch([
    database.db
      .prepare(
        'INSERT INTO excluded_games (league, weekend_start, source_game_id) VALUES (?, ?, ?)',
      )
      .bind('cfl', start, 2),
    database.db.prepare('DELETE FROM games WHERE id=?').bind(week.games[1].id),
    updateLockTime(database.db, 'cfl', start),
  ])
  expect((await syncSchedule(database.db, 'cfl', start))?.lockAt).toBe(manual.startUtc)
  games = []
  await expect(syncSchedule(database.db, 'cfl', start)).rejects.toThrow()
  expect((await getWeek(database.db, 'cfl', start))?.games).toHaveLength(1)
  database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='cfl'")
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')))
  expect((await syncSchedule(database.db, 'cfl', start))?.games[0].startUtc).toBe(manual.startUtc)
  expect(fetch).not.toHaveBeenCalled()
})
it('does not backfill started pools and serves saved weeks safely during outages', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-05T00:00:00Z'))
  expect(await syncSchedule(database.db, 'cfl', start)).toBeNull()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-02T12:01:00Z'))
  await syncSchedule(database.db, 'cfl', start)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private upstream detail')))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await (await request('week?league=cfl')).json()).toMatchObject({
    week: { weekNumber: 1 },
    cflOffseason: false,
    nflOffseason: false,
  })
  expect((await request(`week?league=cfl&start=${start}`)).status).toBe(200)
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-09T12:00:00Z'))
  const response = await request('week?league=cfl')
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private upstream detail')
})
it('freezes team-record snapshots at lock and preserves them on feed failure', async () => {
  await enteredWeek()
  await syncTeamRecords(database.db, 'cfl', start)
  expect((await getWeek(database.db, 'cfl', start))?.games[0].home.record).toBe('2-1-0')
  records = {}
  await expect(getCflRecords('2026-27')).rejects.toThrow('standings')
  await expect(syncTeamRecords(database.db, 'cfl', start)).rejects.toThrow()
  database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='cfl'")
  records = {
    data: {
      divisions: {
        unified: {
          standings: teams.map((team) => ({
            abbreviation: team.abbreviation,
            wins: 99,
            losses: 1,
            ties: 0,
          })),
        },
      },
    },
  }
  await syncTeamRecords(database.db, 'cfl', start)
  expect((await getWeek(database.db, 'cfl', start))?.games[0].home.record).toBe('2-1-0')
})
it('finalizes ties for zero points and includes CFL-only players in combined season totals', async () => {
  await enteredWeek()
  database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='cfl'")
  games = games.map((game) => ({
    ...game,
    game_status: 'Finished',
    home_team_score: 21,
    away_team_score: game.ID === 1 ? 21 : 24,
  }))
  const final = await syncResults(database.db, 'cfl', start)
  expect(final?.status).toBe('final')
  expect(final?.games.map((game) => game.state)).toEqual(['void', 'final'])
  expect(await (await request('season?league=all&season=2026-27')).json()).toMatchObject({
    standings: [
      { username: 'cfl_only', points: 2, cflPoints: 2, nflPoints: null, nhlPoints: null },
    ],
  })
  await syncResults(database.db, 'cfl', start)
  expect(
    database.sqlite.prepare("SELECT COUNT(*) AS n FROM standings WHERE league='cfl'").get()?.n,
  ).toBe(1)
})
it('creates CFL manual weeks with correct opening and season and keeps admin kickoff overrides', async () => {
  const response = await admin(
    new Request('https://pool.example/api/admin/game', {
      method: 'POST',
      body: JSON.stringify({
        league: 'cfl',
        startDate: start,
        gameId: 1,
        startUtc: '2026-06-05T00:00:00Z',
        awayCode: 'TOR',
        homeCode: 'WPG',
        awayName: 'Toronto',
        homeName: 'Winnipeg',
      }),
    }),
    { DB: database.db },
    '/api/admin/game',
  )
  expect(response.status).toBe(200)
  expect(await getWeek(database.db, 'cfl', start)).toMatchObject({
    season: '2026-27',
    weekNumber: 1,
    opensAt: '2026-06-02T12:00:00.000Z',
  })
  expect(
    (await syncSchedule(database.db, 'cfl', start))?.games.find((game) => game.sourceId === 1)
      ?.startUtc,
  ).toBe('2026-06-05T00:00:00Z')
})

it('treats empty schedules as an outage when a persisted season exists', async () => {
  await syncSchedule(database.db, 'cfl', start)
  games = []
  await expect(cflWeekContext(Date.now(), database.db)).rejects.toThrow('unexpectedly empty')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await (await request('week?league=cfl')).json()).toMatchObject({
    week: { weekNumber: 1 },
    cflOffseason: false,
  })
})

it('prefetches the next CFL week within seven days while keeping it unreleased', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-05-01T12:00:00Z'))
  await scheduled({ DB: database.db })
  expect(await getWeek(database.db, 'cfl', start)).toBeNull()
  vi.setSystemTime(Date.parse('2026-06-02T12:01:00Z'))
  await scheduled({ DB: database.db })
  expect((await getWeek(database.db, 'cfl', start))?.weekNumber).toBe(1)
  expect((await getWeek(database.db, 'cfl', '2026-06-11'))?.weekNumber).toBe(2)
  expect(await (await request('weeks?league=cfl')).json()).toMatchObject({
    weeks: [{ week_number: 1 }],
  })
  expect(await (await request('week?league=cfl&start=2026-06-11')).json()).toMatchObject({
    week: null,
  })
  expect(await (await request('open-leagues')).json()).toEqual({ openLeagues: ['cfl'] })
})
