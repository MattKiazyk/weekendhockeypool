import { recapStatements } from './email/store'
import {
  hasEntryDeadlinePassed,
  isWeekendComplete,
  rankScores,
  scoreEntry,
  validatePicks,
  type LeagueId,
  type Pick,
} from '../src/lib/pool'
import { getWeek } from './db'
import { nowIso } from './http'

export async function finalize(db: D1Database, league: LeagueId, start: string): Promise<void> {
  const week = await getWeek(db, league, start)
  if (!week || !hasEntryDeadlinePassed(week)) throw new Error('Entry deadline has not passed')
  if (!isWeekendComplete(week)) {
    throw new Error('Every game must be final or void before publishing standings')
  }
  const rows = await db
    .prepare(
      `SELECT e.clerk_id, k.game_id AS gameId, k.side, k.confidence
    FROM entries e JOIN picks k ON k.entry_id=e.id WHERE e.league=? AND e.weekend_start=?`,
    )
    .bind(league, start)
    .all<Pick & { clerk_id: string }>()
  const entries = new Map<string, Pick[]>()
  for (const row of rows.results) {
    const picks = entries.get(row.clerk_id) ?? []
    picks.push({ gameId: row.gameId, side: row.side, confidence: row.confidence })
    entries.set(row.clerk_id, picks)
  }
  const scores = [...entries].flatMap(([clerkId, picks]) =>
    validatePicks(picks, week.games).length ? [] : [{ clerkId, ...scoreEntry(picks, week.games) }],
  )
  const ranked = rankScores(scores)
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM standings WHERE league=? AND weekend_start=?').bind(league, start),
  ]
  for (const row of ranked) {
    statements.push(
      db
        .prepare(
          'INSERT INTO standings (league, weekend_start, clerk_id, points, correct, rank) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(league, start, row.clerkId, row.points, row.correct, row.rank),
    )
  }
  const finalizedAt = nowIso()
  const players = await db
    .prepare(
      'SELECT p.clerk_id, p.username FROM players p JOIN entries e ON e.clerk_id=p.clerk_id WHERE e.league=? AND e.weekend_start=?',
    )
    .bind(league, start)
    .all<{ clerk_id: string; username: string }>()
  const usernames = new Map(players.results.map((player) => [player.clerk_id, player.username]))
  statements.push(
    ...recapStatements(
      db,
      week,
      ranked
        .map((row) => ({ ...row, username: usernames.get(row.clerkId) ?? 'Player' }))
        .sort((a, b) => a.rank - b.rank || a.username.localeCompare(b.username)),
      finalizedAt,
    ),
  )
  statements.push(
    db
      .prepare("UPDATE weekends SET status='final', finalized_at=? WHERE league=? AND start_date=?")
      .bind(finalizedAt, league, start),
  )
  await db.batch(statements)
}
