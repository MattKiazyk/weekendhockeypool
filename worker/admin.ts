import {
  easternDate,
  isInWeekend,
  seasonFor,
  isWeekendComplete,
  hasEntryDeadlinePassed,
} from '../src/lib/pool'
import { getWeek, upsertGame, updateLockTime } from './db'
import { syncSchedule } from './sync'
import { finalize } from './standings'
import { error, json, validStart } from './http'
import type { Env } from './types'

// Caller must verify administrator access before dispatching here.
export async function admin(request: Request, env: Env, path: string): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  const selected = body.startDate
  if (typeof selected !== 'string' || !validStart(selected))
    return error('Invalid weekend date', 400)
  if (path === '/api/admin/sync') return json({ week: await syncSchedule(env.DB, selected) })
  if (path === '/api/admin/finalize') {
    await finalize(env.DB, selected)
    return json({ week: await getWeek(env.DB, selected) })
  }
  if (path === '/api/admin/game') {
    const gameId = Number(body.gameId)
    const week = await getWeek(env.DB, selected)
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
        "UPDATE games SET state=?, away_score=?, home_score=?, winner=?, source='admin' WHERE id=?",
      )
        .bind(
          body.state,
          body.state === 'final' ? away : null,
          body.state === 'final' ? home : null,
          body.state === 'final' ? (away > home ? 'away' : 'home') : null,
          gameId,
        )
        .run()
      const after = (await getWeek(env.DB, selected))!
      if (isWeekendComplete(after) && hasEntryDeadlinePassed(after))
        await finalize(env.DB, selected)
      return json({ week: await getWeek(env.DB, selected) })
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
    const belongsTo = await env.DB.prepare('SELECT weekend_start FROM games WHERE id=?')
      .bind(gameId)
      .first<{ weekend_start: string }>()
    if (belongsTo && belongsTo.weekend_start !== selected)
      return error('That NHL game ID belongs to another weekend', 409)
    const statements: D1PreparedStatement[] = []
    if (!week) {
      statements.push(
        env.DB.prepare('INSERT INTO weekends (start_date, season) VALUES (?, ?)').bind(
          selected,
          seasonFor(selected),
        ),
      )
    }
    statements.push(
      env.DB.prepare('DELETE FROM excluded_games WHERE weekend_start=? AND game_id=?').bind(
        selected,
        gameId,
      ),
    )
    statements.push(
      upsertGame(
        env.DB,
        selected,
        {
          id: gameId,
          startUtc,
          easternDate: easternDate(startUtc),
          away: {
            code: awayCode,
            name: awayName,
            logo: `https://assets.nhle.com/logos/nhl/svg/${awayCode}_light.svg`,
          },
          home: {
            code: homeCode,
            name: homeName,
            logo: `https://assets.nhle.com/logos/nhl/svg/${homeCode}_light.svg`,
          },
          state: 'scheduled',
          awayScore: null,
          homeScore: null,
          winner: null,
        },
        'admin',
      ),
    )
    statements.push(updateLockTime(env.DB, selected))
    await env.DB.batch(statements)
    return json({ week: await getWeek(env.DB, selected) })
  }
  if (path === '/api/admin/remove-game') {
    const week = await getWeek(env.DB, selected)
    const gameId = Number(body.gameId)
    if (!week || week.status !== 'open' || !week.games.some((game) => game.id === gameId))
      return error('Game list is locked or game not found', 409)
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO excluded_games (weekend_start, game_id) VALUES (?, ?)',
      ).bind(selected, gameId),
      env.DB.prepare('DELETE FROM games WHERE id=? AND weekend_start=?').bind(gameId, selected),
      updateLockTime(env.DB, selected),
    ])
    return json({ week: await getWeek(env.DB, selected) })
  }
  return error('Not found', 404)
}
