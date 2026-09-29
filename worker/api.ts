import {
  addDays,
  easternTimeAt,
  hasEntryDeadlinePassed,
  isEntryOpen,
  rankScores,
  validatePicks,
  weekendStartAt,
  type LeagueId,
  type Pick,
} from '../src/lib/pool'
import { isLeague, leagues } from '../src/lib/leagues'
import { auth } from './auth'
import { admin } from './admin'
import { getWeek, getEntry, saveEntry, savePlayer } from './db'
import { syncSchedule } from './sync'
import { nflWeekContext } from './nfl'
import { error, json, validStart } from './http'
import type { Env } from './types'

export async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const start = url.searchParams.get('start')
  const requestedLeague = url.searchParams.get('league') ?? 'nhl'
  if (path !== '/api/season' && !isLeague(requestedLeague)) return error('Invalid league', 400)
  const league = isLeague(requestedLeague) ? requestedLeague : 'nhl'
  if (path === '/api/open-leagues' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT w.league, w.opens_at AS opensAt, w.lock_at AS lockAt
       FROM weekends w
       WHERE w.status='open' AND EXISTS (
         SELECT 1 FROM games g WHERE g.league=w.league AND g.weekend_start=w.start_date
       )`,
    ).all<{ league: LeagueId; opensAt: string; lockAt: string | null }>()
    const now = Date.now()
    const open = new Set(
      rows.results
        .filter((row) => isEntryOpen({ status: 'open', ...row }, now))
        .map((row) => row.league),
    )
    const openLeagues = leagues.filter((item) => open.has(item.id)).map((item) => item.id)
    return json({ openLeagues })
  }
  if (path === '/api/me' && request.method === 'GET') {
    const user = await auth(request, env)
    if (!user) return error('Sign in required', 401)
    await savePlayer(env.DB, user)
    return json({
      username: user.username,
      isAdmin: !!env.ADMIN_CLERK_USER_ID && user.userId === env.ADMIN_CLERK_USER_ID,
    })
  }
  if (path === '/api/week' && request.method === 'GET') {
    if (league === 'nfl' && start) {
      if (!validStart(start, league)) return error('Invalid weekend date', 400)
      const saved = await getWeek(env.DB, league, start)
      if (saved)
        return json({
          week: saved.opensAt && Date.now() < Date.parse(saved.opensAt) ? null : saved,
          nflOffseason: false,
        })
    }
    let nflContext: Awaited<ReturnType<typeof nflWeekContext>> | null = null
    if (league === 'nfl') {
      try {
        nflContext = await nflWeekContext()
      } catch (cause) {
        console.error('NFL week calendar unavailable', cause)
        if (start) return error('NFL schedule is temporarily unavailable', 503)
        const prefetched = await env.DB.prepare(
          'SELECT start_date FROM weekends WHERE league=? AND opens_at <= ? ORDER BY opens_at DESC LIMIT 1',
        )
          .bind('nfl', new Date(Date.now()).toISOString())
          .first<{ start_date: string }>()
        if (prefetched) {
          const closesAt = easternTimeAt(addDays(prefetched.start_date, 5), 8)
          if (Date.now() < Date.parse(closesAt))
            return json({
              week: await getWeek(env.DB, 'nfl', prefetched.start_date),
              nflOffseason: false,
            })
        }
        return error('NFL schedule is temporarily unavailable', 503)
      }
    }
    const currentStart =
      league === 'nfl' ? nflContext?.active?.startDate : weekendStartAt(Date.now())
    const selected = start ?? currentStart
    if (!selected) return json({ week: null, nflOffseason: nflContext?.offseason ?? false })
    if (!validStart(selected, league)) return error('Invalid weekend date', 400)
    let week = await getWeek(env.DB, league, selected)
    if (league === 'nfl' && week && Date.now() < Date.parse(week.opensAt))
      return json({ week: null, nflOffseason: nflContext?.offseason ?? false })
    if (
      !week &&
      (league === 'nfl'
        ? selected === currentStart
        : [currentStart, addDays(currentStart!, 7)].includes(selected))
    ) {
      week = await syncSchedule(env.DB, league, selected)
    }
    if (league !== 'nfl' && !start && !week?.games.length) {
      const nextStart = addDays(currentStart!, 7)
      const nextWeek =
        (await getWeek(env.DB, league, nextStart)) ??
        (await syncSchedule(env.DB, league, nextStart))
      if (nextWeek?.games.length) week = nextWeek
    }
    return json({ week, nflOffseason: nflContext?.offseason ?? false })
  }
  if (path === '/api/weeks' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT league, start_date, season, week_number, status, lock_at, finalized_at FROM weekends WHERE league=? AND (league!='nfl' OR opens_at <= ?) AND EXISTS (SELECT 1 FROM games WHERE games.league=weekends.league AND games.weekend_start=weekends.start_date) ORDER BY start_date DESC",
    )
      .bind(league, new Date().toISOString())
      .all()
    return json({ weeks: rows.results })
  }
  if (path === '/api/entrants' && request.method === 'GET') {
    if (!validStart(start, league)) return error('Invalid weekend date', 400)
    const entrantsWeek = await getWeek(env.DB, league, start)
    if (league === 'nfl' && entrantsWeek && Date.now() < Date.parse(entrantsWeek.opensAt))
      return error('Week is not available yet', 404)
    const rows = await env.DB.prepare(
      'SELECT p.username FROM entries e JOIN players p ON p.clerk_id=e.clerk_id WHERE e.league=? AND e.weekend_start=? ORDER BY p.username COLLATE NOCASE',
    )
      .bind(league, start)
      .all<{ username: string }>()
    return json({ entrants: rows.results.map((row) => row.username) })
  }
  if (path === '/api/standings' && request.method === 'GET') {
    if (!validStart(start, league)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, league, start)
    if (!week || !hasEntryDeadlinePassed(week) || week.status !== 'final')
      return json({ standings: [] })
    const rows = await env.DB.prepare(
      'SELECT p.username, s.points, s.correct, s.rank FROM standings s JOIN players p ON p.clerk_id=s.clerk_id WHERE s.league=? AND s.weekend_start=? ORDER BY s.rank, p.username',
    )
      .bind(league, start)
      .all()
    return json({ standings: rows.results })
  }
  if (path === '/api/season' && request.method === 'GET') {
    if (requestedLeague !== 'all' && !isLeague(requestedLeague)) return error('Invalid league', 400)
    const season = url.searchParams.get('season')
    if (!season || !/^\d{4}-\d{2}$/.test(season)) return error('Invalid season', 400)
    const combined = requestedLeague === 'all'
    const rows = await env.DB.prepare(
      `SELECT p.username, SUM(s.points) AS points, SUM(s.correct) AS correct,
      SUM(CASE WHEN s.league='nhl' THEN s.points END) AS nhlPoints,
      SUM(CASE WHEN s.league='pwhl' THEN s.points END) AS pwhlPoints,
      SUM(CASE WHEN s.league='nfl' THEN s.points END) AS nflPoints
      FROM standings s JOIN weekends w ON w.league=s.league AND w.start_date=s.weekend_start
      JOIN players p ON p.clerk_id=s.clerk_id
      WHERE w.season=? AND w.status='final' AND (?='all' OR s.league=?)
      GROUP BY s.clerk_id ORDER BY points DESC, p.username`,
    )
      .bind(season, requestedLeague, requestedLeague)
      .all<{
        username: string
        points: number
        correct: number
        nhlPoints: number | null
        pwhlPoints: number | null
        nflPoints: number | null
      }>()
    const standings = rankScores(rows.results)
    return json({
      standings: combined
        ? standings
        : standings.map((row) => ({
            username: row.username,
            points: row.points,
            correct: row.correct,
            rank: row.rank,
          })),
    })
  }
  if (path === '/api/entry' && (request.method === 'GET' || request.method === 'PUT')) {
    const user = await auth(request, env)
    if (!user) return error('Sign in to manage your entry', 401)
    if (request.method === 'GET') {
      if (!validStart(start, league)) return error('Invalid weekend date', 400)
      const entryWeek = await getWeek(env.DB, league, start)
      if (league === 'nfl' && entryWeek && Date.now() < Date.parse(entryWeek.opensAt))
        return error('Week is not available yet', 404)
      const entry = await getEntry(env.DB, league, start, user.userId)
      return json({ entry })
    }
    const body = (await request.json()) as { league?: unknown; startDate?: string; picks?: Pick[] }
    const bodyLeague = body.league ?? 'nhl'
    if (!isLeague(bodyLeague)) return error('Invalid league', 400)
    const bodyStart = body.startDate ?? null
    if (!validStart(bodyStart, bodyLeague) || !Array.isArray(body.picks))
      return error('Invalid entry', 400)
    const week = await getWeek(env.DB, bodyLeague, bodyStart)
    if (week?.status === 'open' && Date.now() < Date.parse(week.opensAt))
      return error(
        `Picks open ${bodyLeague === 'nfl' ? 'Tuesday' : 'Monday'} at 8:00 a.m. Eastern`,
        409,
      )
    if (!week || !isEntryOpen(week)) return error('Entries are closed', 409)
    const errors = validatePicks(body.picks, week.games)
    if (errors.length) return json({ error: errors[0], errors }, 400)
    if (!(await savePlayer(env.DB, user))) return error('Set a Clerk username before entering', 422)
    const timestamp = await saveEntry(env.DB, bodyLeague, bodyStart, user.userId, body.picks)
    return json({ saved: true, updatedAt: timestamp })
  }
  if (path === '/api/picks' && request.method === 'GET') {
    const user = await auth(request, env)
    if (!user) return error('Sign in to view players’ picks', 401)
    if (!validStart(start, league)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, league, start)
    if (!week || !hasEntryDeadlinePassed(week))
      return error('Picks are hidden until the entry deadline', 403)
    const rows = await env.DB.prepare(
      `SELECT p.username, k.game_id, k.side, k.confidence FROM picks k
      JOIN entries e ON e.id=k.entry_id JOIN players p ON p.clerk_id=e.clerk_id
      WHERE e.league=? AND e.weekend_start=? ORDER BY p.username, k.game_id`,
    )
      .bind(league, start)
      .all()
    return json({ picks: rows.results })
  }
  if (path.startsWith('/api/admin/') && request.method === 'POST') {
    const user = await auth(request, env)
    if (!user || !env.ADMIN_CLERK_USER_ID || user.userId !== env.ADMIN_CLERK_USER_ID)
      return error('Admin access required', 403)
    return admin(request, env, path)
  }
  return error('Not found', 404)
}
