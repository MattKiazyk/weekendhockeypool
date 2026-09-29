import { afterEach, expect, it, vi } from 'vitest'
import { easternTimeAt, type Game } from '../src/lib/pool'
import { api } from '../worker/api'
import { auth } from '../worker/auth'
import { getWeek, saveEntry, savePlayer, updateLockTime, upsertGame } from '../worker/db'
import {
  currentNflWeek,
  gameFromNfl,
  getNflSchedule,
  nflWeekContext,
  resultFromNfl,
  weekFromNflCalendar,
  type NflEvent,
} from '../worker/nfl'
import { syncResults, syncSchedule } from '../worker/sync'
import { createTestDatabase } from './helpers/database'

vi.mock('../worker/auth', () => ({ auth: vi.fn() }))

const start = '2026-10-01'
const opener: NflEvent = {
  id: '401872964',
  date: '2026-10-01T00:20:00Z', // Wednesday evening in Eastern time.
  season: { year: 2026, type: 2 },
  week: { number: 4 },
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
  competitions: [
    {
      competitors: [
        {
          homeAway: 'home',
          score: '0',
          team: {
            abbreviation: 'CLE',
            displayName: 'Cleveland Browns',
            logo: 'https://example.com/cle.png',
          },
        },
        {
          homeAway: 'away',
          score: '0',
          team: {
            abbreviation: 'PIT',
            displayName: 'Pittsburgh Steelers',
            logo: 'https://example.com/pit.png',
          },
        },
      ],
    },
  ],
}
const sunday: NflEvent = {
  ...opener,
  id: '401872965',
  date: '2026-10-04T17:00:00Z',
}
const regularEntries = [
  { label: 'Week 3', value: '3', startDate: '2026-09-23T07:00Z', endDate: '2026-09-30T06:59Z' },
  { label: 'Week 4', value: '4', startDate: '2026-09-30T07:00Z', endDate: '2026-10-07T06:59Z' },
  { label: 'Week 18', value: '18', startDate: '2027-01-06T08:00Z', endDate: '2027-01-13T07:59Z' },
]

function mockFeed(events: NflEvent[] = [opener, sunday]) {
  const feed = vi.fn().mockImplementation(async (input: string | URL) => {
    const url = new URL(input.toString())
    if (url.pathname.endsWith('/summary')) {
      const event = events.find((item) => item.id === url.searchParams.get('event'))
      if (!event) return Response.json({}, { status: 404 })
      return Response.json({
        header: {
          week: event.week?.number,
          season: event.season,
          competitions: [
            {
              date: event.date,
              status: event.status,
              competitors: event.competitions[0].competitors,
            },
          ],
        },
      })
    }
    const week = Number(url.searchParams.get('week'))
    return Response.json({
      leagues: [{ calendar: [{ value: '2', entries: regularEntries }] }],
      events: week === 1 ? [] : events.filter((event) => event.week?.number === week),
    })
  })
  vi.stubGlobal('fetch', feed)
  return feed
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses the NFL week calendar and changes weeks at 8 a.m. Eastern, including DST', async () => {
  mockFeed()
  expect(weekFromNflCalendar(regularEntries[1], 2026)).toMatchObject({
    startDate: start,
    number: 4,
    opensAt: '2026-09-29T12:00:00.000Z',
    closesAt: '2026-10-06T12:00:00.000Z',
  })
  expect(easternTimeAt('2026-11-03', 8)).toBe('2026-11-03T13:00:00.000Z')
  expect(
    weekFromNflCalendar(
      {
        label: 'Week 10',
        value: '10',
        startDate: '2026-11-04T08:00Z',
        endDate: '2026-11-11T07:59Z',
      },
      2026,
    ).opensAt,
  ).toBe('2026-11-03T13:00:00.000Z')
  expect((await currentNflWeek(Date.parse('2026-09-29T11:59:59Z')))?.number).toBe(3)
  expect((await nflWeekContext(Date.parse('2026-09-29T11:59:59Z'))).next?.number).toBe(4)
  expect((await currentNflWeek(Date.parse('2026-09-29T12:00:00Z')))?.number).toBe(4)
  expect(await currentNflWeek(Date.parse('2026-10-06T12:00:00Z'))).toBeNull()
  expect((await nflWeekContext(Date.parse('2027-01-12T13:00:00Z'))).offseason).toBe(true)
})

it('includes an official Wednesday game and excludes another NFL week or season type', async () => {
  const feed = mockFeed([
    opener,
    sunday,
    { ...opener, id: '3', week: { number: 5 } },
    { ...opener, id: '4', season: { year: 2026, type: 3 } },
  ])
  const schedule = await getNflSchedule(start)
  expect(schedule.games.map((game) => game.sourceId)).toEqual([401872964, 401872965])
  expect(schedule.games[0]).toMatchObject({
    easternDate: '2026-09-30',
    away: { code: 'PIT' },
    home: { code: 'CLE' },
  })
  expect(schedule.weekNumber).toBe(4)
  expect(feed).toHaveBeenCalledWith(
    expect.stringContaining('/scoreboard?'),
    expect.objectContaining({
      headers: expect.objectContaining({ 'user-agent': 'curl/8.7.1' }),
    }),
  )
})

it('keeps a Week 18 slate when its first game is on Sunday', async () => {
  mockFeed([{ ...opener, id: '401872999', date: '2027-01-10T18:00:00Z', week: { number: 18 } }])
  const schedule = await getNflSchedule('2027-01-07')
  expect(schedule.weekNumber).toBe(18)
  expect(schedule.games).toMatchObject([{ easternDate: '2027-01-10' }])
})

it('voids an official tie, postponement, or move to another NFL week', () => {
  const final: NflEvent = {
    ...opener,
    status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
    competitions: [
      { competitors: opener.competitions[0].competitors.map((team) => ({ ...team, score: '20' })) },
    ],
  }
  expect(resultFromNfl(final, 4).state).toBe('void')
  expect(resultFromNfl({ ...final, week: { number: 5 } }, 4).state).toBe('void')
  expect(
    resultFromNfl(
      { ...final, status: { type: { name: 'STATUS_POSTPONED', state: 'pre', completed: false } } },
      4,
    ).state,
  ).toBe('void')
  const winner = {
    ...final,
    competitions: [
      {
        competitors: [
          { ...final.competitions[0].competitors[0], score: '21' },
          { ...final.competitions[0].competitors[1], score: '20' },
        ],
      },
    ],
  }
  expect(resultFromNfl(winner, 4)).toMatchObject({ state: 'final', winner: 'home' })
})

it('hides unreleased weeks and enforces opening in API and D1 while retaining the deadline', async () => {
  const database = createTestDatabase()
  try {
    mockFeed()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T12:00:00Z'))
    const week = await syncSchedule(database.db, 'nfl', start)
    expect(week?.weekNumber).toBe(4)
    expect(week?.lockAt).toBe(opener.date.replace('Z', '.000Z'))
    database.sqlite.exec("UPDATE weekends SET lock_at='2099-10-01T00:00:00Z' WHERE league='nfl'")
    const gameIds = week!.games.map((game) => game.id)
    const picks = gameIds.map((gameId, index) => ({
      gameId,
      side: 'away' as const,
      confidence: index + 1,
    }))
    await savePlayer(database.db, { userId: 'player-1', username: 'footballfan' })
    await expect(saveEntry(database.db, 'nfl', start, 'player-1', picks)).rejects.toThrow(
      'entries are closed',
    )
    vi.mocked(auth).mockResolvedValue({ userId: 'player-1', username: 'footballfan' })
    const request = (path: string, method = 'GET', body?: unknown) =>
      api(
        new Request(`https://pool.example/api/${path}`, {
          method,
          ...(body
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        }),
        { DB: database.db } as never,
      )
    expect(await (await request(`week?league=nfl&start=${start}`)).json()).toMatchObject({
      week: null,
    })
    expect(await (await request('weeks?league=nfl')).json()).toEqual({ weeks: [] })
    expect((await request('entry', 'PUT', { league: 'nfl', startDate: start, picks })).status).toBe(
      409,
    )
    await database.db
      .prepare(
        'INSERT INTO weekends (league, start_date, season, week_number, opens_at, lock_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind('nfl', '2026-09-24', '2026-27', 3, '2026-09-22T12:00:00Z', '2026-09-25T00:00:00Z')
      .run()
    await upsertGame(
      database.db,
      'nfl',
      '2026-09-24',
      gameFromNfl({ ...opener, id: '999', date: '2026-09-25T00:00:00Z', week: { number: 3 } }),
      'feed',
    ).run()
    expect(await (await request('week?league=nfl')).json()).toMatchObject({
      week: { weekNumber: 3 },
    })
    database.sqlite.exec("UPDATE weekends SET opens_at='2000-01-01T00:00:00Z' WHERE league='nfl'")
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T12:01:00Z'))
    expect((await request('entry', 'PUT', { league: 'nfl', startDate: start, picks })).status).toBe(
      200,
    )
    expect((await request(`week?league=nfl&start=${start}`)).status).toBe(200)
    expect(await (await request('week?league=nfl')).json()).toMatchObject({
      week: { weekNumber: 4 },
    })
    database.sqlite.exec(
      "UPDATE weekends SET opens_at='2026-09-29T12:00:00Z' WHERE league='nfl' AND week_number=4",
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ESPN unavailable')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await (await request('week?league=nfl')).json()).toMatchObject({
      week: { weekNumber: 4 },
    })
    database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='nfl'")
    expect((await request('entry', 'PUT', { league: 'nfl', startDate: start, picks })).status).toBe(
      409,
    )
    await expect(saveEntry(database.db, 'nfl', start, 'player-1', picks)).rejects.toThrow(
      'entries are closed',
    )
  } finally {
    database.sqlite.close()
  }
})

it('does not create a results-only pool after the first kickoff', async () => {
  const database = createTestDatabase()
  try {
    mockFeed()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:21:00Z'))
    expect(await syncSchedule(database.db, 'nfl', start)).toBeNull()
    expect(await getWeek(database.db, 'nfl', start)).toBeNull()
    expect(
      await (
        await api(new Request('https://pool.example/api/week?league=nfl'), {
          DB: database.db,
        } as never)
      ).json(),
    ).toMatchObject({
      week: null,
      nflOffseason: false,
    })
  } finally {
    database.sqlite.close()
  }
})

it('retains NFL manual overrides and exclusions during an open-week refresh', async () => {
  const database = createTestDatabase()
  try {
    mockFeed()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T12:01:00Z'))
    const first = (await syncSchedule(database.db, 'nfl', start))!
    const manual = { ...first.games[0], startUtc: '2026-10-01T00:30:00Z' }
    await upsertGame(database.db, 'nfl', start, manual, 'admin').run()
    await database.db.batch([
      database.db
        .prepare(
          'INSERT INTO excluded_games (league, weekend_start, source_game_id) VALUES (?, ?, ?)',
        )
        .bind('nfl', start, sunday.id),
      database.db.prepare('DELETE FROM games WHERE id=?').bind(first.games[1].id),
      updateLockTime(database.db, 'nfl', start),
    ])
    const refreshed = (await syncSchedule(database.db, 'nfl', start))!
    expect(refreshed.games).toHaveLength(1)
    expect(refreshed.games[0].startUtc).toBe(manual.startUtc)
    expect(refreshed.lockAt).toBe(manual.startUtc)
    mockFeed([])
    await expect(syncSchedule(database.db, 'nfl', start)).rejects.toThrow('empty replacement')
  } finally {
    database.sqlite.close()
  }
})

it('finalizes a locked NFL week with an official tie worth zero', async () => {
  const database = createTestDatabase()
  try {
    mockFeed()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T12:01:00Z'))
    const week = (await syncSchedule(database.db, 'nfl', start))!
    await savePlayer(database.db, { userId: 'player-1', username: 'footballfan' })
    database.sqlite.exec(
      "UPDATE weekends SET opens_at='2000-01-01T00:00:00Z', lock_at='2099-10-01T00:00:00Z' WHERE league='nfl'",
    )
    await saveEntry(
      database.db,
      'nfl',
      start,
      'player-1',
      week.games.map((game: Game, index: number) => ({
        gameId: game.id,
        side: 'away',
        confidence: index + 1,
      })),
    )
    database.sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='nfl'")
    const finished = (event: NflEvent) => ({
      ...event,
      status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
      competitions: [
        {
          competitors: event.competitions[0].competitors.map((team) => ({
            ...team,
            score: event.id === opener.id ? '17' : team.homeAway === 'away' ? '24' : '21',
          })),
        },
      ],
    })
    mockFeed([finished(opener), finished(sunday)])
    const final = await syncResults(database.db, 'nfl', start)
    expect(final?.status).toBe('final')
    expect(final?.games.map((game) => game.state)).toEqual(['void', 'final'])
    expect(
      database.sqlite.prepare("SELECT points, correct FROM standings WHERE league='nfl'").all(),
    ).toEqual([{ points: 2, correct: 1 }])
  } finally {
    database.sqlite.close()
  }
})
