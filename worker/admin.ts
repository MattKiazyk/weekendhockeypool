import type { AdminUsersData, AdminEntryStatus } from '../src/lib/api'
import { leagues } from '../src/lib/leagues'
import { validatePicks, type LeagueId, type Pick } from '../src/lib/pool'
import { usesNumberedWeeks, leagueSeasonFor } from '../src/lib/leagues'
import { getCflSchedule, cflWeekByStart } from './cfl'
import { addDays } from '../src/lib/pool'
import {
  easternDate,
  entryOpensAt,
  isInWeekend,
  isWeekendComplete,
  hasEntryDeadlinePassed,
} from '../src/lib/pool'
import { isLeague } from '../src/lib/leagues'
import { getWeek, upsertGame, updateLockTime } from './db'
import { syncSchedule } from './sync'
import { getNflSchedule, nflWeekByStart } from './nfl'
import { finalize } from './standings'
import { error, json, validStart } from './http'
import type { Env } from './types'

// Caller must verify administrator access before dispatching here.
export async function admin(request: Request, env: Env, path: string): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  const league = body.league ?? 'nhl'
  if (!isLeague(league)) return error('Invalid league', 400)
  const selected = body.startDate
  if (typeof selected !== 'string' || !validStart(selected, league))
    return error('Invalid weekend date', 400)
  if (path === '/api/admin/sync') {
    const week = await syncSchedule(env.DB, league, selected)
    return week ? json({ week }) : error(`${league.toUpperCase()} week has already started`, 409)
  }
  if (path === '/api/admin/finalize') {
    await finalize(env.DB, league, selected)
    return json({ week: await getWeek(env.DB, league, selected) })
  }
  if (path === '/api/admin/game') {
    const gameId = Number(body.gameId)
    const week = await getWeek(env.DB, league, selected)
    if (!Number.isInteger(gameId) || gameId <= 0) return error('Invalid game', 400)
    const current = week?.games.find((game) => game.id === gameId)
    if (current && (body.state === 'final' || body.state === 'void')) {
      const away = Number(body.awayScore)
      const home = Number(body.homeScore)
      if (
        body.state === 'final' &&
        (!Number.isInteger(away) ||
          !Number.isInteger(home) ||
          away === home ||
          away < 0 ||
          home < 0)
      )
        return error('Enter different nonnegative final scores', 400)
      await env.DB.prepare(
        "UPDATE games SET state=?, away_score=?, home_score=?, winner=?, source='admin' WHERE id=? AND league=?",
      )
        .bind(
          body.state,
          body.state === 'final' ? away : null,
          body.state === 'final' ? home : null,
          body.state === 'final' ? (away > home ? 'away' : 'home') : null,
          gameId,
          league,
        )
        .run()
      const after = (await getWeek(env.DB, league, selected))!
      if (isWeekendComplete(after) && hasEntryDeadlinePassed(after))
        await finalize(env.DB, league, selected)
      return json({ week: await getWeek(env.DB, league, selected) })
    }
    if (body.state === 'final' || body.state === 'void') return error('Game not found', 404)
    if (week && week.status !== 'open') return error('The game list is frozen', 409)
    const startUtc = String(body.startUtc ?? '')
    const awayCode = String(body.awayCode ?? '').toUpperCase()
    const homeCode = String(body.homeCode ?? '').toUpperCase()
    const awayName = String(body.awayName ?? '').trim()
    const homeName = String(body.homeName ?? '').trim()
    const nflWeek = league === 'nfl' ? await nflWeekByStart(selected) : null
    const cflWeek = league === 'cfl' ? await cflWeekByStart(selected, env.DB) : null
    const numberedWeek = cflWeek ?? nflWeek
    const inCflWeek =
      !!cflWeek &&
      Number.isFinite(Date.parse(startUtc)) &&
      easternDate(startUtc) >= selected &&
      easternDate(startUtc) < addDays(selected, 7)
    const inNflWeek =
      !!nflWeek &&
      Date.parse(startUtc) >= Date.parse(nflWeek.feedStartsAt) &&
      Date.parse(startUtc) <= Date.parse(nflWeek.feedEndsAt)
    if (
      !Number.isFinite(Date.parse(startUtc)) ||
      (league === 'nfl'
        ? !inNflWeek
        : league === 'cfl'
          ? !inCflWeek
          : !isInWeekend(easternDate(startUtc), selected)) ||
      !/^[A-Z]{2,4}$/.test(awayCode) ||
      !/^[A-Z]{2,4}$/.test(homeCode) ||
      !awayName ||
      !homeName
    )
      return error('Complete the matchup with a valid week start time', 400)
    const belongsTo = await env.DB.prepare(
      'SELECT weekend_start FROM games WHERE league=? AND source_game_id=?',
    )
      .bind(league, gameId)
      .first<{ weekend_start: string }>()
    if (belongsTo && belongsTo.weekend_start !== selected)
      return error('That game ID belongs to another weekend', 409)
    const statements: D1PreparedStatement[] = []
    if (!week) {
      if (usesNumberedWeeks(league)) {
        const schedule =
          league === 'cfl' ? await getCflSchedule(selected, env.DB) : await getNflSchedule(selected)
        if (
          !schedule.games.length ||
          Date.now() >= Date.parse(schedule.games.map((game) => game.startUtc).sort()[0])
        )
          return error(`${league.toUpperCase()} week has already started`, 409)
      }
      statements.push(
        env.DB.prepare(
          'INSERT INTO weekends (league, start_date, season, week_number, opens_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(
          league,
          selected,
          leagueSeasonFor(league, selected),
          numberedWeek?.number ?? null,
          numberedWeek?.opensAt ?? entryOpensAt(selected),
        ),
      )
    }
    statements.push(
      env.DB.prepare(
        'DELETE FROM excluded_games WHERE league=? AND weekend_start=? AND source_game_id=?',
      ).bind(league, selected, gameId),
    )
    statements.push(
      upsertGame(
        env.DB,
        league,
        selected,
        {
          id: gameId,
          sourceId: gameId,
          startUtc,
          easternDate: easternDate(startUtc),
          away: {
            code: awayCode,
            name: awayName,
            logo:
              league === 'nhl'
                ? `https://assets.nhle.com/logos/nhl/svg/${awayCode}_light.svg`
                : null,
          },
          home: {
            code: homeCode,
            name: homeName,
            logo:
              league === 'nhl'
                ? `https://assets.nhle.com/logos/nhl/svg/${homeCode}_light.svg`
                : null,
          },
          state: 'scheduled',
          awayScore: null,
          homeScore: null,
          winner: null,
        },
        'admin',
      ),
    )
    statements.push(updateLockTime(env.DB, league, selected))
    await env.DB.batch(statements)
    return json({ week: await getWeek(env.DB, league, selected) })
  }
  if (path === '/api/admin/remove-game') {
    const week = await getWeek(env.DB, league, selected)
    const gameId = Number(body.gameId)
    const game = week?.games.find((item) => item.id === gameId)
    if (!week || week.status !== 'open' || !game)
      return error('Game list is locked or game not found', 409)
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO excluded_games (league, weekend_start, source_game_id) VALUES (?, ?, ?)',
      ).bind(league, selected, game.sourceId),
      env.DB.prepare('DELETE FROM games WHERE id=? AND league=? AND weekend_start=?').bind(
        gameId,
        league,
        selected,
      ),
      updateLockTime(env.DB, league, selected),
    ])
    return json({ week: await getWeek(env.DB, league, selected) })
  }
  return error('Not found', 404)
}

export async function adminUsers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  for (const { id } of leagues) {
    const selected = url.searchParams.get(id)
    if (selected !== null && !validStart(selected, id)) return error('Invalid week date', 400)
  }
  const weeks = await env.DB.prepare(
    `SELECT league, start_date, week_number, opens_at FROM weekends w
     WHERE EXISTS (SELECT 1 FROM games g WHERE g.league=w.league AND g.weekend_start=w.start_date)
     ORDER BY start_date DESC`,
  ).all<{ league: LeagueId; start_date: string; week_number: number | null; opens_at: string }>()
  const columns: AdminUsersData['columns'] = leagues.map(({ id }) => {
    const options = weeks.results.filter((week) => week.league === id)
    return {
      league: id,
      selectedStart:
        url.searchParams.get(id) ??
        options.find((week) => Date.parse(week.opens_at) <= Date.now())?.start_date ??
        null,
      weeks: options.map((week) => ({ startDate: week.start_date, weekNumber: week.week_number })),
    }
  })
  for (const column of columns) {
    if (
      column.selectedStart &&
      !column.weeks.some((week) => week.startDate === column.selectedStart)
    )
      return error('Week not found', 404)
  }
  const accounts = await env.DB.prepare(
    `SELECT a.clerk_id, COALESCE(a.username, p.username) AS username
     FROM email_accounts a LEFT JOIN players p ON p.clerk_id=a.clerk_id
     WHERE a.deleted_at IS NULL
     UNION ALL
     SELECT p.clerk_id, p.username FROM players p
     WHERE NOT EXISTS (SELECT 1 FROM email_accounts a WHERE a.clerk_id=p.clerk_id)
     ORDER BY username COLLATE NOCASE, clerk_id`,
  ).all<{ clerk_id: string; username: string | null }>()
  const statuses = new Map<string, AdminEntryStatus>()
  for (const column of columns) {
    if (!column.selectedStart) continue
    const week = await getWeek(env.DB, column.league, column.selectedStart)
    if (!week?.games.length) continue
    const rows = await env.DB.prepare(
      `SELECT e.clerk_id, k.game_id, k.side, k.confidence FROM entries e
       LEFT JOIN picks k ON k.entry_id=e.id WHERE e.league=? AND e.weekend_start=?`,
    )
      .bind(column.league, column.selectedStart)
      .all<{
        clerk_id: string
        game_id: number | null
        side: Pick['side']
        confidence: number
      }>()
    const entries = new Map<string, Pick[]>()
    for (const row of rows.results) {
      const picks = entries.get(row.clerk_id) ?? []
      if (row.game_id !== null)
        picks.push({ gameId: row.game_id, side: row.side, confidence: row.confidence })
      entries.set(row.clerk_id, picks)
    }
    for (const [userId, picks] of entries) {
      statuses.set(
        `${column.league}:${userId}`,
        validatePicks(picks, week.games).length ? 'incomplete' : 'submitted',
      )
    }
  }
  const users = accounts.results.map((account) => ({
    userId: account.clerk_id,
    username: account.username,
    entries: Object.fromEntries(
      columns.map((column) => [
        column.league,
        column.selectedStart
          ? (statuses.get(`${column.league}:${account.clerk_id}`) ?? 'not-entered')
          : 'no-pool',
      ]),
    ) as Record<LeagueId, AdminEntryStatus>,
  }))
  return json({ columns, users } satisfies AdminUsersData)
}
