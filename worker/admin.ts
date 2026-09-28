import {
  easternDate,
  entryOpensAt,
  isInWeekend,
  seasonFor,
  isWeekendComplete,
  hasEntryDeadlinePassed,
} from '../src/lib/pool'
import { isLeague } from '../src/lib/leagues'
import { getWeek, upsertGame, updateLockTime } from './db'
import { syncSchedule } from './sync'
import { finalize } from './standings'
import { error, json, validStart } from './http'
import type { Env } from './types'

// Caller must verify administrator access before dispatching here.
export async function admin(request: Request, env: Env, path: string): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  const league = body.league ?? 'nhl'
  if (!isLeague(league)) return error('Invalid league', 400)
  const selected = body.startDate
  if (typeof selected !== 'string' || !validStart(selected))
    return error('Invalid weekend date', 400)
  if (path === '/api/admin/sync')
    return json({ week: await syncSchedule(env.DB, league, selected) })
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
    if (
      !Number.isFinite(Date.parse(startUtc)) ||
      !isInWeekend(easternDate(startUtc), selected) ||
      !/^[A-Z]{2,4}$/.test(awayCode) ||
      !/^[A-Z]{2,4}$/.test(homeCode) ||
      !awayName ||
      !homeName
    )
      return error('Complete the matchup with a weekend start time', 400)
    const belongsTo = await env.DB.prepare(
      'SELECT weekend_start FROM games WHERE league=? AND source_game_id=?',
    )
      .bind(league, gameId)
      .first<{ weekend_start: string }>()
    if (belongsTo && belongsTo.weekend_start !== selected)
      return error('That game ID belongs to another weekend', 409)
    const statements: D1PreparedStatement[] = []
    if (!week) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO weekends (league, start_date, season, opens_at) VALUES (?, ?, ?, ?)',
        ).bind(league, selected, seasonFor(selected), entryOpensAt(selected)),
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
