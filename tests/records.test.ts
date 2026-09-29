import { afterEach, describe, expect, it, vi } from 'vitest'
import { easternDate, easternTimeAt } from '../src/lib/pool'
import { getWeek, updateLockTime, upsertGame } from '../worker/db'
import { getNhlRecords } from '../worker/nhl'
import { getPwhlRecords } from '../worker/pwhl'
import { getNflRecords } from '../worker/nfl'
import { recordRefreshDue, syncTeamRecords } from '../worker/sync'
import { feedFor } from '../worker/feeds'
import { createTestDatabase } from './helpers/database'

vi.mock('../worker/feeds', () => ({ feedFor: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('standings records', () => {
  it('reads NHL wins, losses, and overtime losses from the matching season', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json({
          standings: [
            {
              teamAbbrev: { default: 'WPG' },
              seasonId: 20262027,
              wins: 4,
              losses: 2,
              otLosses: 1,
            },
          ],
        }),
      ),
    )
    expect(await getNhlRecords('2026-27')).toEqual(new Map([['WPG', '4-2-1']]))
    await expect(getNhlRecords('2025-26')).rejects.toThrow('season does not match')
  })

  it('uses PWHL regulation and overtime counts in league order', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            SiteKit: {
              Seasons: [{ season_id: '11', season_name: '2026-27 Regular Season', playoff: '0' }],
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            SiteKit: {
              Statviewtype: [
                { repeatheader: 1, name: 'PWHL' },
                {
                  team_code: 'BOS',
                  regulation_wins: '3',
                  non_reg_wins: '2',
                  non_reg_losses: '1',
                  losses: '4',
                  games_played: '10',
                },
              ],
            },
          }),
        ),
    )
    expect(await getPwhlRecords('2026-27')).toEqual(new Map([['BOS', '3-2-1-4']]))
  })

  it('reads NFL wins, losses, and ties', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          children: [
            {
              standings: {
                entries: [
                  {
                    team: { abbreviation: 'KC' },
                    stats: [
                      { name: 'wins', value: 3 },
                      { name: 'losses', value: 1 },
                      { name: 'ties', value: 0 },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ),
    )
    expect(await getNflRecords('2026-27')).toEqual(new Map([['KC', '3-1-0']]))
  })
})

describe('record snapshots', () => {
  it('recognizes 7:30 Eastern in both daylight and standard time', () => {
    expect(recordRefreshDue(Date.parse('2026-09-29T11:30:00Z'))).toBe(true)
    expect(recordRefreshDue(Date.parse('2026-09-29T11:31:00Z'))).toBe(true)
    expect(recordRefreshDue(Date.parse('2027-01-05T12:30:00Z'))).toBe(true)
    expect(recordRefreshDue(Date.parse('2026-09-29T12:30:00Z'))).toBe(false)
  })

  it('saves complete records on opening day before 8, including an open weekend, then freezes at lock', async () => {
    const { db, sqlite } = createTestDatabase()
    try {
      const today = easternDate(Date.now())
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await db
        .prepare('INSERT INTO weekends (league, start_date, season, opens_at) VALUES (?, ?, ?, ?)')
        .bind('nhl', today, '2026-27', `${today}T12:00:00Z`)
        .run()
      await db.batch([
        upsertGame(
          db,
          'nhl',
          today,
          {
            id: 1,
            sourceId: 1,
            startUtc: tomorrow,
            easternDate: easternDate(tomorrow),
            away: { code: 'WPG', name: 'Jets', logo: null },
            home: { code: 'TOR', name: 'Maple Leafs', logo: null },
            state: 'scheduled',
            awayScore: null,
            homeScore: null,
            winner: null,
          },
          'feed',
        ),
        updateLockTime(db, 'nhl', today),
      ])
      const records = vi.fn().mockResolvedValue(
        new Map([
          ['WPG', '4-2-1'],
          ['TOR', '3-3-0'],
        ]),
      )
      vi.mocked(feedFor).mockReturnValue({ records } as never)
      const openingMorning = Date.parse(easternTimeAt(today, 7)) + 30 * 60 * 1000
      await syncTeamRecords(db, 'nhl', today, openingMorning)
      expect((await getWeek(db, 'nhl', today))?.games[0].away.record).toBe('4-2-1')
      await syncTeamRecords(db, 'nhl', today, Date.parse(tomorrow))
      expect((await getWeek(db, 'nhl', today))?.games[0].away.record).toBe('4-2-1')
      await db
        .prepare('INSERT INTO weekends (league, start_date, season, opens_at) VALUES (?, ?, ?, ?)')
        .bind('nhl', '2000-01-01', '1999-00', '2000-01-01T00:00:00Z')
        .run()
      await upsertGame(
        db,
        'nhl',
        '2000-01-01',
        {
          id: 2,
          sourceId: 2,
          startUtc: new Date(openingMorning - 3600000).toISOString(),
          easternDate: today,
          away: { code: 'BOS', name: 'Bruins', logo: null },
          home: { code: 'NYR', name: 'Rangers', logo: null },
          state: 'scheduled',
          awayScore: null,
          homeScore: null,
          winner: null,
        },
        'feed',
      ).run()
      sqlite.exec("UPDATE games SET state='live' WHERE source_game_id=2 AND league='nhl'")
      await syncTeamRecords(db, 'nhl', today, openingMorning)
      expect(records).toHaveBeenCalledTimes(1)
      sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='nhl'")
      await syncTeamRecords(db, 'nhl', today, Date.now())
      expect((await getWeek(db, 'nhl', today))?.games[0].away.record).toBe('4-2-1')
      await expect(
        db
          .prepare("UPDATE team_records SET record='9-0-0' WHERE league='nhl' AND team_code='WPG'")
          .run(),
      ).rejects.toThrow('team records are locked')
    } finally {
      sqlite.close()
    }
  })

  it('keeps the previous snapshot when a feed omits a team or the deadline passes during fetch', async () => {
    const { db, sqlite } = createTestDatabase()
    try {
      const today = easternDate(Date.now())
      await db
        .prepare(
          'INSERT INTO weekends (league, start_date, season, opens_at, lock_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          'nfl',
          today,
          '2026-27',
          new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
        )
        .run()
      await upsertGame(
        db,
        'nfl',
        today,
        {
          id: 1,
          sourceId: 1,
          startUtc: new Date(Date.now() + 3600000).toISOString(),
          easternDate: today,
          away: { code: 'KC', name: 'Chiefs', logo: null },
          home: { code: 'BUF', name: 'Bills', logo: null },
          state: 'scheduled',
          awayScore: null,
          homeScore: null,
          winner: null,
        },
        'feed',
      ).run()
      vi.mocked(feedFor).mockReturnValue({
        records: vi.fn().mockResolvedValue(new Map([['KC', '3-1-0']])),
      } as never)
      await expect(syncTeamRecords(db, 'nfl', today)).rejects.toThrow('missing a pool team')
      expect((await getWeek(db, 'nfl', today))?.games[0].away.record).toBeNull()
      vi.mocked(feedFor).mockReturnValue({
        records: vi.fn().mockImplementation(async () => {
          sqlite.exec("UPDATE weekends SET lock_at='2000-01-01T00:00:00Z' WHERE league='nfl'")
          return new Map([
            ['KC', '3-1-0'],
            ['BUF', '2-2-0'],
          ])
        }),
      } as never)
      await syncTeamRecords(db, 'nfl', today)
      expect((await getWeek(db, 'nfl', today))?.games[0].away.record).toBeNull()
    } finally {
      sqlite.close()
    }
  })
})
