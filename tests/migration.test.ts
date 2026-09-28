import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { entryOpensAt } from '../src/lib/pool'

it('preserves populated NHL data while introducing league-scoped records', () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    const migrations = readdirSync('migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
    for (const name of migrations.filter((name) => name < '0007_leagues.sql'))
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    sqlite.exec(`
      INSERT INTO players VALUES ('player-1', 'rinkside', '2099-01-01T00:00:00Z');
      INSERT INTO weekends (start_date, season, lock_at) VALUES ('2099-10-09', '2099-00', '2099-10-09T23:00:00Z');
      INSERT INTO games (id, weekend_start, start_utc, eastern_date, away_code, away_name, home_code, home_name)
        VALUES (1, '2099-10-09', '2099-10-09T23:00:00Z', '2099-10-09', 'BOS', 'Boston', 'TOR', 'Toronto');
      INSERT INTO entries (id, weekend_start, clerk_id, submitted_at, updated_at)
        VALUES (4, '2099-10-09', 'player-1', '2099-10-01T00:00:00Z', '2099-10-01T00:00:00Z');
      INSERT INTO picks VALUES (4, 1, 'home', 1);
      INSERT INTO standings VALUES ('2099-10-09', 'player-1', 1, 1, 1);
      INSERT INTO excluded_games VALUES ('2099-10-09', 2);
    `)
    sqlite.exec(readFileSync('migrations/0007_leagues.sql', 'utf8'))
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.prepare('SELECT league, start_date FROM weekends').all()).toEqual([
      { league: 'nhl', start_date: '2099-10-09' },
    ])
    expect(sqlite.prepare('SELECT id, league, source_game_id, source FROM games').all()).toEqual([
      { id: 1, league: 'nhl', source_game_id: 1, source: 'feed' },
    ])
    expect(sqlite.prepare('SELECT id, league, clerk_id FROM entries').all()).toEqual([
      { id: 4, league: 'nhl', clerk_id: 'player-1' },
    ])
    expect(sqlite.prepare('SELECT entry_id, game_id, confidence FROM picks').all()).toEqual([
      { entry_id: 4, game_id: 1, confidence: 1 },
    ])
    expect(sqlite.prepare('SELECT league, points FROM standings').all()).toEqual([
      { league: 'nhl', points: 1 },
    ])
    expect(sqlite.prepare('SELECT league, source_game_id FROM excluded_games').all()).toEqual([
      { league: 'nhl', source_game_id: 2 },
    ])
    sqlite.exec(`
      INSERT INTO weekends (league, start_date, season) VALUES ('pwhl', '2099-10-09', '2099-00');
      INSERT INTO games (league, source_game_id, weekend_start, start_utc, eastern_date,
        away_code, away_name, home_code, home_name)
        VALUES ('pwhl', 1, '2099-10-09', '2099-10-09T23:00:00Z', '2099-10-09',
        'BOS', 'Boston', 'TOR', 'Toronto');
    `)
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM games WHERE source_game_id=1').get(),
    ).toEqual({ count: 2 })
  } finally {
    sqlite.close()
  }
})

it('backfills Eastern opening times without removing early entries', () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    for (const name of readdirSync('migrations')
      .filter((name) => name.endsWith('.sql') && name < '0008_entry_open_time.sql')
      .sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    sqlite.exec(`
      INSERT INTO players VALUES ('player-1', 'rinkside', '2026-01-01T00:00:00Z');
      INSERT INTO weekends (league, start_date, season, lock_at)
        VALUES ('nhl', '2027-03-12', '2026-27', '2027-03-12T23:00:00Z'),
               ('nhl', '2027-03-19', '2026-27', '2027-03-19T23:00:00Z'),
               ('nhl', '2027-11-05', '2027-28', '2027-11-05T23:00:00Z'),
               ('nhl', '2027-11-12', '2027-28', '2027-11-12T23:00:00Z');
      INSERT INTO games (id, league, source_game_id, weekend_start, start_utc, eastern_date,
        away_code, away_name, home_code, home_name)
        VALUES (1, 'nhl', 1, '2027-03-12', '2027-03-12T23:00:00Z', '2027-03-12',
          'BOS', 'Boston', 'TOR', 'Toronto');
      INSERT INTO entries (id, league, weekend_start, clerk_id, submitted_at, updated_at)
        VALUES (4, 'nhl', '2027-03-12', 'player-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO picks VALUES (4, 1, 'home', 1);
    `)
    sqlite.exec(readFileSync('migrations/0008_entry_open_time.sql', 'utf8'))
    const rows = sqlite
      .prepare('SELECT start_date, opens_at FROM weekends ORDER BY start_date')
      .all() as { start_date: string; opens_at: string }[]
    expect(rows).toEqual(
      ['2027-03-12', '2027-03-19', '2027-11-05', '2027-11-12'].map((start_date) => ({
        start_date,
        opens_at: entryOpensAt(start_date).replace('.000Z', 'Z'),
      })),
    )
    expect(sqlite.prepare('SELECT id FROM entries').all()).toEqual([{ id: 4 }])
    expect(sqlite.prepare('SELECT entry_id, game_id FROM picks').all()).toEqual([
      { entry_id: 4, game_id: 1 },
    ])
    expect(() => sqlite.exec("UPDATE entries SET updated_at='2026-02-01' WHERE id=4")).toThrow(
      'entries are closed',
    )
  } finally {
    sqlite.close()
  }
})
