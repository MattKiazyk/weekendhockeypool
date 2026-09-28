import type { Game, Weekend, Pick, Side, Entry, LeagueId } from '../src/lib/pool'
import type { Player } from './types'
import { nowIso } from './http'

interface GameRow {
  id: number
  source_game_id: number
  start_utc: string
  eastern_date: string
  away_code: string
  away_name: string
  away_logo: string | null
  home_code: string
  home_name: string
  home_logo: string | null
  state: Game['state']
  away_score: number | null
  home_score: number | null
  winner: Side | null
}

interface WeekRow {
  league: LeagueId
  start_date: string
  season: string
  lock_at: string | null
  status: Weekend['status']
  finalized_at: string | null
}

function fromRow(row: GameRow): Game {
  return {
    id: row.id,
    sourceId: row.source_game_id,
    startUtc: row.start_utc,
    easternDate: row.eastern_date,
    away: { code: row.away_code, name: row.away_name, logo: row.away_logo },
    home: { code: row.home_code, name: row.home_name, logo: row.home_logo },
    state: row.state,
    awayScore: row.away_score,
    homeScore: row.home_score,
    winner: row.winner,
  }
}

export async function getWeek(
  db: D1Database,
  league: LeagueId,
  start: string,
): Promise<Weekend | null> {
  const week = await db
    .prepare('SELECT * FROM weekends WHERE league = ? AND start_date = ?')
    .bind(league, start)
    .first<WeekRow>()
  if (!week) return null
  const rows = await db
    .prepare('SELECT * FROM games WHERE league = ? AND weekend_start = ? ORDER BY start_utc, id')
    .bind(league, start)
    .all<GameRow>()
  const status =
    week.status === 'final'
      ? 'final'
      : week.lock_at && Date.now() >= Date.parse(week.lock_at)
        ? 'locked'
        : 'open'
  return {
    league,
    startDate: start,
    season: week.season,
    lockAt: week.lock_at,
    status,
    finalizedAt: week.finalized_at,
    games: rows.results.map(fromRow),
  }
}

export async function savePlayer(db: D1Database, user: Player): Promise<boolean> {
  if (!user.username) return false
  await db
    .prepare(
      'INSERT INTO players (clerk_id, username, updated_at) VALUES (?, ?, ?) ON CONFLICT(clerk_id) DO UPDATE SET username=excluded.username, updated_at=excluded.updated_at',
    )
    .bind(user.userId, user.username, nowIso())
    .run()
  return true
}

export function upsertGame(
  db: D1Database,
  league: LeagueId,
  start: string,
  game: Game,
  source: 'feed' | 'admin',
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO games (league, source_game_id, weekend_start, start_utc, eastern_date, away_code, away_name, away_logo, home_code, home_name, home_logo, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(league, source_game_id) DO UPDATE SET
    start_utc=excluded.start_utc, eastern_date=excluded.eastern_date,
    away_code=excluded.away_code, away_name=excluded.away_name, away_logo=excluded.away_logo,
    home_code=excluded.home_code, home_name=excluded.home_name, home_logo=excluded.home_logo, source=excluded.source
    WHERE games.source!='admin' OR excluded.source='admin'`,
    )
    .bind(
      league,
      game.sourceId,
      start,
      game.startUtc,
      game.easternDate,
      game.away.code,
      game.away.name,
      game.away.logo,
      game.home.code,
      game.home.name,
      game.home.logo,
      source,
    )
}

export function updateLockTime(
  db: D1Database,
  league: LeagueId,
  start: string,
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE weekends SET lock_at=(SELECT MIN(start_utc) FROM games WHERE league=? AND weekend_start=?) WHERE league=? AND start_date=?',
    )
    .bind(league, start, league, start)
}

export async function getEntry(
  db: D1Database,
  league: LeagueId,
  start: string,
  userId: string,
): Promise<Entry | null> {
  const row = await db
    .prepare(
      'SELECT id, submitted_at, updated_at FROM entries WHERE league=? AND weekend_start=? AND clerk_id=?',
    )
    .bind(league, start, userId)
    .first<{ id: number; submitted_at: string; updated_at: string }>()
  if (!row) return null
  const picks = await db
    .prepare(
      'SELECT game_id AS gameId, side, confidence FROM picks WHERE entry_id=? ORDER BY game_id',
    )
    .bind(row.id)
    .all<Pick>()
  return { submittedAt: row.submitted_at, updatedAt: row.updated_at, picks: picks.results }
}

export async function saveEntry(
  db: D1Database,
  league: LeagueId,
  start: string,
  userId: string,
  picks: Pick[],
): Promise<string> {
  const timestamp = nowIso()
  const statements = [
    db
      .prepare(
        `INSERT INTO entries (league, weekend_start, clerk_id, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(league, weekend_start, clerk_id) DO UPDATE SET updated_at=excluded.updated_at`,
      )
      .bind(league, start, userId, timestamp, timestamp),
    db
      .prepare(
        'DELETE FROM picks WHERE entry_id=(SELECT id FROM entries WHERE league=? AND weekend_start=? AND clerk_id=?)',
      )
      .bind(league, start, userId),
    ...picks.map((pick) =>
      db
        .prepare(
          `INSERT INTO picks (entry_id, game_id, side, confidence)
      VALUES ((SELECT id FROM entries WHERE league=? AND weekend_start=? AND clerk_id=?), ?, ?, ?)`,
        )
        .bind(league, start, userId, pick.gameId, pick.side, pick.confidence),
    ),
  ]
  await db.batch(statements)
  return timestamp
}
