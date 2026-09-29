import {
  addDays,
  easternDate,
  entryOpensAt,
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
import { nflWeekContext } from './nfl'
import { nowIso } from './http'
import { finalize } from './standings'
import type { Env } from './types'

export function syncSchedule(
  db: D1Database,
  league: 'nhl' | 'pwhl',
  start: string,
): Promise<Weekend>
export function syncSchedule(db: D1Database, league: 'nfl', start: string): Promise<Weekend | null>
export function syncSchedule(
  db: D1Database,
  league: LeagueId,
  start: string,
): Promise<Weekend | null>
export async function syncSchedule(
  db: D1Database,
  league: LeagueId,
  start: string,
): Promise<Weekend | null> {
  const existing = await getWeek(db, league, start)
  if (existing && existing.status !== 'open') return existing
  const { games: eligible, season, weekNumber, opensAt } = await feedFor(league).schedule(start)
  if (league === 'nfl' && !existing) {
    const firstKickoff = lockTime(eligible)
    if (!firstKickoff || Date.now() >= Date.parse(firstKickoff)) return null
  }
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
      `INSERT INTO weekends (league, start_date, season, week_number, opens_at, lock_at, last_schedule_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(league, start_date) DO UPDATE SET
       week_number=excluded.week_number, opens_at=excluded.opens_at,
       lock_at=excluded.lock_at, last_schedule_sync=excluded.last_schedule_sync`,
    )
    .bind(
      league,
      start,
      season,
      weekNumber ?? null,
      opensAt ?? entryOpensAt(start),
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

export function recordRefreshDue(now = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  return parts.find((part) => part.type === 'hour')?.value === '07' && minute >= 30 && minute < 45
}

export async function syncTeamRecords(
  db: D1Database,
  league: LeagueId,
  start: string,
  now = Date.now(),
): Promise<void> {
  const week = await getWeek(db, league, start)
  if (
    !week ||
    week.status !== 'open' ||
    !week.lockAt ||
    now >= Date.parse(week.lockAt) ||
    easternDate(now) < easternDate(week.opensAt) ||
    !week.games.length
  )
    return
  const live = await db
    .prepare("SELECT 1 FROM games WHERE league=? AND state='live' AND start_utc > ? LIMIT 1")
    .bind(league, new Date(now - 18 * 60 * 60 * 1000).toISOString())
    .first()
  if (live) return
  const records = await feedFor(league).records(week.season)
  const codes = new Set(week.games.flatMap((game) => [game.away.code, game.home.code]))
  if ([...codes].some((code) => !records.has(code)))
    throw new Error(`${league.toUpperCase()} standings are missing a pool team`)
  const current = await getWeek(db, league, start)
  if (
    !current ||
    current.status !== 'open' ||
    !current.lockAt ||
    Date.now() >= Date.parse(current.lockAt)
  )
    return
  const updatedAt = nowIso()
  await db.batch(
    [...codes].map((code) =>
      db
        .prepare(
          `INSERT INTO team_records (league, weekend_start, team_code, record, updated_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(league, weekend_start, team_code) DO UPDATE SET
         record=excluded.record, updated_at=excluded.updated_at`,
        )
        .bind(league, start, code, records.get(code)!, updatedAt),
    ),
  )
}

export async function scheduled(env: Env): Promise<void> {
  const runAt = Date.now()
  const current = weekendStartAt(runAt)
  const next = addDays(current, 7)
  const dailyRefresh = new Date().getUTCHours() === 12 && new Date().getUTCMinutes() < 15
  for (const { id: league } of leagues.filter((item) => item.id !== 'nfl')) {
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
  try {
    const nfl = await nflWeekContext()
    for (const selected of [nfl.active, nfl.next]) {
      if (!selected) continue
      const future = Date.parse(selected.opensAt) > Date.now()
      if (future && Date.parse(selected.opensAt) - Date.now() > 7 * 24 * 60 * 60 * 1000) continue
      const week = await getWeek(env.DB, 'nfl', selected.startDate)
      if (!week || (week.status === 'open' && (!future || dailyRefresh)))
        await syncSchedule(env.DB, 'nfl', selected.startDate)
    }
  } catch (cause) {
    console.error('NFL schedule sync failed', cause)
  }
  if (recordRefreshDue(runAt)) {
    const rows = await env.DB.prepare(
      "SELECT league, start_date FROM weekends WHERE status='open' AND lock_at > ? ORDER BY start_date",
    )
      .bind(nowIso())
      .all<{ league: LeagueId; start_date: string }>()
    for (const row of rows.results) {
      try {
        await syncTeamRecords(env.DB, row.league, row.start_date, runAt)
      } catch (cause) {
        console.error(`Team record sync failed for ${row.league} ${row.start_date}`, cause)
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
