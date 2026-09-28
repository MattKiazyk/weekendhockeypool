import {
  addDays,
  easternDate,
  isInWeekend,
  lockTime,
  seasonFor,
  weekendStartAt,
  isWeekendComplete,
  hasEntryDeadlinePassed,
  type Weekend,
} from '../src/lib/pool'
import { getWeek, upsertGame } from './db'
import { nhl, gameFromNhl, resultFromNhl, type NhlGame } from './nhl'
import { finalize } from './standings'
import { nowIso } from './http'
import type { Env } from './types'

export async function syncSchedule(db: D1Database, start: string): Promise<Weekend> {
  const existing = await getWeek(db, start)
  if (existing && existing.status !== 'open') return existing
  const feed = (await nhl(`schedule/${start}`)) as {
    gameWeek?: { date: string; games: NhlGame[] }[]
  }
  if (!Array.isArray(feed.gameWeek)) throw new Error('NHL schedule response is invalid')
  const excluded = await db
    .prepare('SELECT game_id FROM excluded_games WHERE weekend_start=?')
    .bind(start)
    .all<{ game_id: number }>()
  const excludedIds = new Set(excluded.results.map((row) => row.game_id))
  const eligible = feed.gameWeek
    .flatMap((day) => day.games ?? [])
    .filter((game) => game.gameType === 2 && isInWeekend(easternDate(game.startTimeUTC), start))
  const games = eligible
    .filter((game) => !excludedIds.has(game.id))
    .map(gameFromNhl)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.id - b.id)
  // A transient empty response must never erase a published slate.
  if (existing?.games.length && !eligible.length)
    throw new Error('NHL returned an empty replacement schedule')
  const adminRows = await db
    .prepare("SELECT id FROM games WHERE weekend_start=? AND source='admin'")
    .bind(start)
    .all<{ id: number }>()
  const adminIds = new Set(adminRows.results.map((row) => row.id))
  const retainedAdmin = (existing?.games ?? []).filter((game) => adminIds.has(game.id))
  const timestamp = nowIso()
  const weekStatement = db
    .prepare(
      `INSERT INTO weekends (start_date, season, lock_at, last_schedule_sync)
    VALUES (?, ?, ?, ?) ON CONFLICT(start_date) DO UPDATE SET lock_at=excluded.lock_at, last_schedule_sync=excluded.last_schedule_sync`,
    )
    .bind(
      start,
      seasonFor(start),
      lockTime([...games.filter((game) => !adminIds.has(game.id)), ...retainedAdmin]),
      timestamp,
    )
  const statements: D1PreparedStatement[] = existing ? [] : [weekStatement]
  statements.push(...games.map((game) => upsertGame(db, start, game, 'nhl')))
  for (const old of existing?.games ?? []) {
    if (!games.some((game) => game.id === old.id) && !adminIds.has(old.id))
      statements.push(db.prepare('DELETE FROM games WHERE id = ?').bind(old.id))
  }
  if (existing) statements.push(weekStatement)
  await db.batch(statements)
  return (await getWeek(db, start))!
}

export async function syncResults(db: D1Database, start: string): Promise<Weekend | null> {
  const week = await getWeek(db, start)
  if (!week || week.status === 'final' || !week.games.length) return week
  const days = [start, addDays(start, 1), addDays(start, 2)]
  const responses = (await Promise.all(days.map((date) => nhl(`score/${date}`)))) as {
    games?: NhlGame[]
  }[]
  if (responses.some((response) => !Array.isArray(response.games)))
    throw new Error('NHL score response is invalid')
  const scores = new Map(
    responses.flatMap((response) => response.games ?? []).map((game) => [game.id, game]),
  )
  const statements: D1PreparedStatement[] = []
  for (const game of week.games) {
    let source = scores.get(game.id)
    if (!source && game.state !== 'final' && game.state !== 'void') {
      try {
        source = (await nhl(`gamecenter/${game.id}/landing`)) as NhlGame
      } catch {
        /* retry on next run */
      }
    }
    if (!source) continue
    const result = resultFromNhl(source, game)
    // The update guard keeps administrator corrections authoritative.
    statements.push(
      db
        .prepare(
          "UPDATE games SET state=?, away_score=?, home_score=?, winner=? WHERE id=? AND source!='admin'",
        )
        .bind(result.state, result.awayScore, result.homeScore, result.winner, game.id),
    )
  }
  statements.push(
    db.prepare('UPDATE weekends SET last_result_sync=? WHERE start_date=?').bind(nowIso(), start),
  )
  await db.batch(statements)
  const updated = (await getWeek(db, start))!
  if (isWeekendComplete(updated) && hasEntryDeadlinePassed(updated)) {
    await finalize(db, start)
    return (await getWeek(db, start))!
  }
  return updated
}

export async function scheduled(env: Env): Promise<void> {
  const current = weekendStartAt(Date.now())
  const next = addDays(current, 7)
  for (const start of [current, next]) {
    const week = await getWeek(env.DB, start)
    const stale =
      !week ||
      !(
        await env.DB.prepare('SELECT last_schedule_sync FROM weekends WHERE start_date=?')
          .bind(start)
          .first<{ last_schedule_sync: string | null }>()
      )?.last_schedule_sync
    const dailyRefresh = new Date().getUTCHours() === 12 && new Date().getUTCMinutes() < 15
    if (!week || (week.status === 'open' && (stale || dailyRefresh))) {
      try {
        await syncSchedule(env.DB, start)
      } catch (cause) {
        console.error(`Schedule sync failed for ${start}`, cause)
      }
    }
  }
  const pending = await env.DB.prepare(
    "SELECT start_date FROM weekends WHERE status!='final' AND lock_at IS NOT NULL AND lock_at <= ? ORDER BY start_date DESC LIMIT 4",
  )
    .bind(nowIso())
    .all<{ start_date: string }>()
  for (const row of pending.results) {
    try {
      await syncResults(env.DB, row.start_date)
    } catch (cause) {
      console.error(`Result sync failed for ${row.start_date}`, cause)
    }
  }
}
