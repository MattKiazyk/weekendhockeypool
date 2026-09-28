import {
  addDays,
  hasEntryDeadlinePassed,
  isEntryOpen,
  rankScores,
  validatePicks,
  weekendStartAt,
  type Pick,
} from '../src/lib/pool'
import { auth } from './auth'
import { admin } from './admin'
import { getWeek, getEntry, saveEntry, savePlayer } from './db'
import { syncSchedule } from './sync'
import { error, json, validStart } from './http'
import type { Env } from './types'

export async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const start = url.searchParams.get('start')
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
    const currentStart = weekendStartAt(Date.now())
    const selected = start ?? currentStart
    if (!validStart(selected)) return error('Invalid weekend date', 400)
    let week = await getWeek(env.DB, selected)
    if (!week && [currentStart, addDays(currentStart, 7)].includes(selected)) {
      week = await syncSchedule(env.DB, selected)
    }
    if (!start && !week?.games.length) {
      const nextStart = addDays(currentStart, 7)
      const nextWeek = (await getWeek(env.DB, nextStart)) ?? (await syncSchedule(env.DB, nextStart))
      if (nextWeek.games.length) week = nextWeek
    }
    return json({ week })
  }
  if (path === '/api/weeks' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT start_date, season, status, lock_at, finalized_at FROM weekends WHERE EXISTS (SELECT 1 FROM games WHERE games.weekend_start=weekends.start_date) ORDER BY start_date DESC LIMIT 24',
    ).all()
    return json({ weeks: rows.results })
  }
  if (path === '/api/entrants' && request.method === 'GET') {
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const rows = await env.DB.prepare(
      'SELECT p.username FROM entries e JOIN players p ON p.clerk_id=e.clerk_id WHERE e.weekend_start=? ORDER BY p.username COLLATE NOCASE',
    )
      .bind(start)
      .all<{ username: string }>()
    return json({ entrants: rows.results.map((row) => row.username) })
  }
  if (path === '/api/standings' && request.method === 'GET') {
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, start)
    if (!week || !hasEntryDeadlinePassed(week) || week.status !== 'final')
      return json({ standings: [] })
    const rows = await env.DB.prepare(
      'SELECT p.username, s.points, s.correct, s.rank FROM standings s JOIN players p ON p.clerk_id=s.clerk_id WHERE s.weekend_start=? ORDER BY s.rank, p.username',
    )
      .bind(start)
      .all()
    return json({ standings: rows.results })
  }
  if (path === '/api/season' && request.method === 'GET') {
    const season = url.searchParams.get('season')
    if (!season || !/^\d{4}-\d{2}$/.test(season)) return error('Invalid season', 400)
    const rows = await env.DB.prepare(
      `SELECT p.username, SUM(s.points) AS points, SUM(s.correct) AS correct
      FROM standings s JOIN weekends w ON w.start_date=s.weekend_start JOIN players p ON p.clerk_id=s.clerk_id
      WHERE w.season=? AND w.status='final' GROUP BY s.clerk_id ORDER BY points DESC, p.username`,
    )
      .bind(season)
      .all<{ username: string; points: number; correct: number }>()
    return json({ standings: rankScores(rows.results) })
  }
  if (path === '/api/entry' && (request.method === 'GET' || request.method === 'PUT')) {
    const user = await auth(request, env)
    if (!user) return error('Sign in to manage your entry', 401)
    if (request.method === 'GET') {
      if (!validStart(start)) return error('Invalid weekend date', 400)
      const entry = await getEntry(env.DB, start, user.userId)
      return json({ entry })
    }
    const body = (await request.json()) as { startDate?: string; picks?: Pick[] }
    const bodyStart = body.startDate ?? null
    if (!validStart(bodyStart) || !Array.isArray(body.picks)) return error('Invalid entry', 400)
    const week = await getWeek(env.DB, bodyStart)
    if (!week || !isEntryOpen(week)) return error('Entries are closed', 409)
    const errors = validatePicks(body.picks, week.games)
    if (errors.length) return json({ error: errors[0], errors }, 400)
    if (!(await savePlayer(env.DB, user))) return error('Set a Clerk username before entering', 422)
    const timestamp = await saveEntry(env.DB, bodyStart, user.userId, body.picks)
    return json({ saved: true, updatedAt: timestamp })
  }
  if (path === '/api/picks' && request.method === 'GET') {
    const user = await auth(request, env)
    if (!user) return error('Sign in to view players’ picks', 401)
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, start)
    if (!week || !hasEntryDeadlinePassed(week))
      return error('Picks are hidden until the entry deadline', 403)
    const rows = await env.DB.prepare(
      `SELECT p.username, k.game_id, k.side, k.confidence FROM picks k
      JOIN entries e ON e.id=k.entry_id JOIN players p ON p.clerk_id=e.clerk_id
      WHERE e.weekend_start=? ORDER BY p.username, k.game_id`,
    )
      .bind(start)
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
