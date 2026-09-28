import {
  addDays,
  hasEntryDeadlinePassed,
  isWeekendComplete,
  lockTime,
  weekendStartAt,
  type LeagueId,
  type Weekend,
} from '../src/lib/pool'
import { leagues } from '../src/lib/leagues'
import { getWeek, upsertGame } from './db'
import { feedFor } from './feeds'
import { nowIso } from './http'
import { finalize } from './standings'
import type { Env } from './types'

export async function syncSchedule(
  db: D1Database,
  league: LeagueId,
  start: string,
): Promise<Weekend> {
  const existing = await getWeek(db, league, start)
  if (existing && existing.status !== 'open') return existing
  const { games: eligible, season } = await feedFor(league).schedule(start)
  const excluded = await db
    .prepare('SELECT source_game_id FROM excluded_games WHERE league=? AND weekend_start=?')
    .bind(league, start)
    .all<{ source_game_id: number }>()
  const excludedIds = new Set(excluded.results.map((row) => row.source_game_id))
  const games = eligible
    .filter((game) => !excludedIds.has(game.sourceId))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.sourceId - b.sourceId)
  if (existing?.games.length && !eligible.length)
    throw new Error(`${league.toUpperCase()} returned an empty replacement schedule`)
  const adminRows = await db
    .prepare(
      "SELECT source_game_id FROM games WHERE league=? AND weekend_start=? AND source='admin'",
    )
    .bind(league, start)
    .all<{ source_game_id: number }>()
  const adminIds = new Set(adminRows.results.map((row) => row.source_game_id))
  const retainedAdmin = (existing?.games ?? []).filter((game) => adminIds.has(game.sourceId))
  const weekStatement = db
    .prepare(
      `INSERT INTO weekends (league, start_date, season, lock_at, last_schedule_sync)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(league, start_date) DO UPDATE SET
       lock_at=excluded.lock_at, last_schedule_sync=excluded.last_schedule_sync`,
    )
    .bind(
      league,
      start,
      season,
      lockTime([...games.filter((game) => !adminIds.has(game.sourceId)), ...retainedAdmin]),
      nowIso(),
    )
  const statements: D1PreparedStatement[] = existing ? [] : [weekStatement]
  statements.push(...games.map((game) => upsertGame(db, league, start, game, 'feed')))
  for (const old of existing?.games ?? []) {
    if (!games.some((game) => game.sourceId === old.sourceId) && !adminIds.has(old.sourceId))
      statements.push(db.prepare('DELETE FROM games WHERE id=? AND league=?').bind(old.id, league))
  }
  if (existing) statements.push(weekStatement)
  await db.batch(statements)
  return (await getWeek(db, league, start))!
}

export async function syncResults(
  db: D1Database,
  league: LeagueId,
  start: string,
): Promise<Weekend | null> {
  const week = await getWeek(db, league, start)
  if (!week || week.status === 'final' || !week.games.length) return week
  const results = await feedFor(league).results(week)
  const statements: D1PreparedStatement[] = []
  for (const game of week.games) {
    const result = results.get(game.sourceId)
    if (!result) continue
    statements.push(
      db
        .prepare(
          "UPDATE games SET state=?, away_score=?, home_score=?, winner=? WHERE id=? AND league=? AND source!='admin'",
        )
        .bind(result.state, result.awayScore, result.homeScore, result.winner, game.id, league),
    )
  }
  statements.push(
    db
      .prepare('UPDATE weekends SET last_result_sync=? WHERE league=? AND start_date=?')
      .bind(nowIso(), league, start),
  )
  await db.batch(statements)
  const updated = (await getWeek(db, league, start))!
  if (isWeekendComplete(updated) && hasEntryDeadlinePassed(updated)) {
    await finalize(db, league, start)
    return (await getWeek(db, league, start))!
  }
  return updated
}

export async function scheduled(env: Env): Promise<void> {
  const current = weekendStartAt(Date.now())
  const next = addDays(current, 7)
  const dailyRefresh = new Date().getUTCHours() === 12 && new Date().getUTCMinutes() < 15
  for (const { id: league } of leagues) {
    for (const start of [current, next]) {
      const week = await getWeek(env.DB, league, start)
      if (!week || (week.status === 'open' && dailyRefresh)) {
        try {
          await syncSchedule(env.DB, league, start)
        } catch (cause) {
          console.error(`Schedule sync failed for ${league} ${start}`, cause)
        }
      }
    }
  }
  const pending = await env.DB.prepare(
    "SELECT league, start_date FROM weekends WHERE status!='final' AND lock_at IS NOT NULL AND lock_at <= ? ORDER BY start_date DESC LIMIT 12",
  )
    .bind(nowIso())
    .all<{ league: LeagueId; start_date: string }>()
  for (const row of pending.results) {
    try {
      await syncResults(env.DB, row.league, row.start_date)
    } catch (cause) {
      console.error(`Result sync failed for ${row.league} ${row.start_date}`, cause)
    }
  }
}
