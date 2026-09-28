import { afterEach, expect, it, vi } from 'vitest'
import { addDays, seasonFor, weekendStartAt } from '../src/lib/pool'
import { getWeek, saveEntry, savePlayer, updateLockTime, upsertGame } from '../worker/db'
import { gameFromPwhl, getPwhlSchedule, resultFromPwhl, type PwhlGame } from '../worker/pwhl'
import { syncResults, syncSchedule } from '../worker/sync'
import { createTestDatabase } from './helpers/database'

const start = weekendStartAt('2099-12-05T12:00:00Z')
const season = seasonFor(start)
const saturday = addDays(start, 1)
const sunday = addDays(start, 2)
const raw: PwhlGame = {
  id: '1',
  season_id: '99',
  GameDateISO8601: `${saturday}T15:00:00-05:00`,
  date_tbd: '0',
  time_tbd: '0',
  home_team: '2',
  visiting_team: '1',
  home_team_name: 'Toronto Sceptres',
  home_team_code: 'TOR',
  visiting_team_name: 'Boston Fleet',
  visiting_team_code: 'BOS',
  home_goal_count: '0',
  visiting_goal_count: '0',
  started: '0',
  final: '0',
  game_status: '3:00 pm EST',
  game_type: 'Regular Season',
}

function mockFeed(games: PwhlGame[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: string | URL) => {
      const view = new URL(input.toString()).searchParams.get('view')
      const data =
        view === 'seasons'
          ? {
              Seasons: [
                { season_id: '98', season_name: `${season} Pre-Season`, playoff: '0' },
                {
                  season_id: '99',
                  season_name: `${season} Regular Season`,
                  playoff: '0',
                  start_date: start,
                  end_date: addDays(start, 90),
                },
              ],
            }
          : view === 'schedule'
            ? { Schedule: games }
            : {
                Teamsbyseason: [
                  { id: '1', team_logo_url: 'https://assets.example/bos.png' },
                  { id: '2', team_logo_url: 'https://assets.example/tor.png' },
                ],
              }
      return Response.json({ SiteKit: data })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

it('discovers the regular season and uses the offset-aware PWHL time and team logos', async () => {
  mockFeed([raw, { ...raw, id: '2', game_type: 'Exhibition' }, { ...raw, id: '3', date_tbd: '1' }])
  const schedule = await getPwhlSchedule(start)
  expect(schedule.season).toBe(season)
  expect(schedule.games).toHaveLength(1)
  expect(schedule.games[0]).toMatchObject({
    sourceId: 1,
    startUtc: `${saturday}T20:00:00.000Z`,
    easternDate: saturday,
    away: { code: 'BOS', logo: 'https://assets.example/bos.png' },
  })
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
})

it('maps final scores and voids postponed or moved games', () => {
  const game = gameFromPwhl(raw, new Map())
  expect(
    resultFromPwhl(
      { ...raw, final: '1', started: '1', visiting_goal_count: '3', home_goal_count: '2' },
      game,
    ),
  ).toMatchObject({ state: 'final', winner: 'away' })
  expect(resultFromPwhl({ ...raw, game_status: 'Postponed' }, game).state).toBe('void')
  expect(
    resultFromPwhl({ ...raw, game_status: 'Postponed', GameDateISO8601: '' }, game).state,
  ).toBe('void')
  expect(
    resultFromPwhl({ ...raw, GameDateISO8601: `${addDays(start, 3)}T15:00:00-05:00` }, game).state,
  ).toBe('void')
  expect(
    resultFromPwhl({ ...raw, final: '1', visiting_goal_count: '2', home_goal_count: '2' }, game)
      .winner,
  ).toBeNull()
  expect(resultFromPwhl({ ...raw, GameDateISO8601: `${sunday}T21:00:00-05:00` }, game).state).toBe(
    'scheduled',
  )
})

it('preserves PWHL overrides and exclusions and rejects an empty replacement', async () => {
  const database = createTestDatabase()
  try {
    mockFeed([raw, { ...raw, id: '2', GameDateISO8601: `${sunday}T16:00:00-05:00` }])
    const first = await syncSchedule(database.db, 'pwhl', start)
    const changed = { ...first.games[0], startUtc: `${saturday}T20:30:00.000Z` }
    await upsertGame(database.db, 'pwhl', start, changed, 'admin').run()
    await database.db.batch([
      database.db
        .prepare(
          'INSERT INTO excluded_games (league, weekend_start, source_game_id) VALUES (?, ?, ?)',
        )
        .bind('pwhl', start, 2),
      database.db.prepare('DELETE FROM games WHERE id=?').bind(first.games[1].id),
      updateLockTime(database.db, 'pwhl', start),
    ])
    const updated = await syncSchedule(database.db, 'pwhl', start)
    expect(updated.games).toHaveLength(1)
    expect(updated.games[0].startUtc).toBe(changed.startUtc)
    expect(updated.lockAt).toBe(changed.startUtc)
    mockFeed([])
    await expect(syncSchedule(database.db, 'pwhl', start)).rejects.toThrow(
      'empty replacement schedule',
    )
    expect((await getWeek(database.db, 'pwhl', start))?.games).toHaveLength(1)
  } finally {
    database.sqlite.close()
  }
})

it('finalizes a PWHL entry from the schedule result feed', async () => {
  const database = createTestDatabase()
  try {
    mockFeed([raw])
    const week = await syncSchedule(database.db, 'pwhl', start)
    await savePlayer(database.db, { userId: 'player-1', username: 'rinkside' })
    database.sqlite
      .prepare('UPDATE weekends SET opens_at=? WHERE league=?')
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), 'pwhl')
    await saveEntry(database.db, 'pwhl', start, 'player-1', [
      { gameId: week.games[0].id, side: 'away', confidence: 1 },
    ])
    database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='pwhl'")
    mockFeed([{ ...raw, started: '1', final: '1', visiting_goal_count: '3', home_goal_count: '2' }])
    expect((await syncResults(database.db, 'pwhl', start))?.status).toBe('final')
    expect(
      database.sqlite.prepare("SELECT points, correct FROM standings WHERE league='pwhl'").all(),
    ).toEqual([{ points: 1, correct: 1 }])
  } finally {
    database.sqlite.close()
  }
})
