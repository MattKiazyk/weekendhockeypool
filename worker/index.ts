import { createClerkClient } from '@clerk/backend'
import { addDays, easternDate, hasEntryDeadlinePassed, isEntryOpen, isInWeekend, lockTime, rankScores, scoreEntry, seasonFor, validatePicks, weekendStartAt, type Entry, type Game, type Pick, type Side, type Weekend } from '../src/lib/pool'

interface Env {
  DB: D1Database
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_SECRET_KEY?: string
  ADMIN_CLERK_USER_ID?: string
}

interface GameRow {
  id: number
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
  start_date: string
  season: string
  lock_at: string | null
  status: Weekend['status']
  finalized_at: string | null
}

type NhlTeam = { abbrev: string; logo?: string; placeName?: { default?: string }; commonName?: { default?: string }; name?: { default?: string }; score?: number }
type NhlGame = { id: number; gameType: number; startTimeUTC: string; gameState: string; gameScheduleState?: string; awayTeam: NhlTeam; homeTeam: NhlTeam }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const error = (message: string, status: number) => json({ error: message }, status)
const validStart = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).getUTCDay() === 5
const nowIso = () => new Date().toISOString()

function fromRow(row: GameRow): Game {
  return {
    id: row.id, startUtc: row.start_utc, easternDate: row.eastern_date,
    away: { code: row.away_code, name: row.away_name, logo: row.away_logo },
    home: { code: row.home_code, name: row.home_name, logo: row.home_logo },
    state: row.state, awayScore: row.away_score, homeScore: row.home_score, winner: row.winner,
  }
}

async function getWeek(db: D1Database, start: string): Promise<Weekend | null> {
  const week = await db.prepare('SELECT * FROM weekends WHERE start_date = ?').bind(start).first<WeekRow>()
  if (!week) return null
  const rows = await db.prepare('SELECT * FROM games WHERE weekend_start = ? ORDER BY start_utc, id').bind(start).all<GameRow>()
  const status = week.status === 'final' ? 'final' : week.lock_at && Date.now() >= Date.parse(week.lock_at) ? 'locked' : 'open'
  return { startDate: start, season: week.season, lockAt: week.lock_at, status, finalizedAt: week.finalized_at, games: rows.results.map(fromRow) }
}

async function nhl(path: string): Promise<unknown> {
  const response = await fetch(`https://api-web.nhle.com/v1/${path}`, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; WeekendHockeyPool/1.0)' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`NHL feed returned ${response.status}`)
  return response.json()
}

function teamName(team: NhlTeam): string {
  const place = team.placeName?.default ?? ''
  const common = team.commonName?.default ?? team.name?.default ?? ''
  return `${place} ${common}`.trim() || team.abbrev
}

function gameFromNhl(raw: NhlGame): Game {
  return {
    id: raw.id, startUtc: raw.startTimeUTC, easternDate: easternDate(raw.startTimeUTC),
    away: { code: raw.awayTeam.abbrev, name: teamName(raw.awayTeam), logo: raw.awayTeam.logo ?? null },
    home: { code: raw.homeTeam.abbrev, name: teamName(raw.homeTeam), logo: raw.homeTeam.logo ?? null },
    state: 'scheduled', awayScore: null, homeScore: null, winner: null,
  }
}

async function syncSchedule(db: D1Database, start: string): Promise<Weekend> {
  const existing = await getWeek(db, start)
  if (existing && existing.status !== 'open') return existing
  const feed = await nhl(`schedule/${start}`) as { gameWeek?: { date: string; games: NhlGame[] }[] }
  if (!Array.isArray(feed.gameWeek)) throw new Error('NHL schedule response is invalid')
  const excluded = await db.prepare('SELECT game_id FROM excluded_games WHERE weekend_start=?').bind(start).all<{ game_id: number }>()
  const excludedIds = new Set(excluded.results.map((row) => row.game_id))
  const eligible = feed.gameWeek.flatMap((day) => day.games ?? [])
    .filter((game) => game.gameType === 2 && isInWeekend(easternDate(game.startTimeUTC), start))
  const games = eligible.filter((game) => !excludedIds.has(game.id))
    .map(gameFromNhl).sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.id - b.id)
  // A transient empty response must never erase a published slate.
  if (existing?.games.length && !eligible.length) throw new Error('NHL returned an empty replacement schedule')
  const adminRows = await db.prepare("SELECT id FROM games WHERE weekend_start=? AND source='admin'").bind(start).all<{ id: number }>()
  const adminIds = new Set(adminRows.results.map((row) => row.id))
  const retainedAdmin = (existing?.games ?? []).filter((game) => adminIds.has(game.id))
  const timestamp = nowIso()
  const weekStatement = db.prepare(`INSERT INTO weekends (start_date, season, lock_at, last_schedule_sync)
    VALUES (?, ?, ?, ?) ON CONFLICT(start_date) DO UPDATE SET lock_at=excluded.lock_at, last_schedule_sync=excluded.last_schedule_sync`)
    .bind(start, seasonFor(start), lockTime([...games, ...retainedAdmin]), timestamp)
  const statements: D1PreparedStatement[] = existing ? [] : [weekStatement]
  for (const game of games) {
    statements.push(db.prepare(`INSERT INTO games (id, weekend_start, start_utc, eastern_date, away_code, away_name, away_logo, home_code, home_name, home_logo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      start_utc=excluded.start_utc, eastern_date=excluded.eastern_date, away_code=excluded.away_code,
      away_name=excluded.away_name, away_logo=excluded.away_logo, home_code=excluded.home_code,
      home_name=excluded.home_name, home_logo=excluded.home_logo WHERE games.source!='admin'`)
      .bind(game.id, start, game.startUtc, game.easternDate, game.away.code, game.away.name, game.away.logo, game.home.code, game.home.name, game.home.logo))
  }
  for (const old of existing?.games ?? []) {
    if (!games.some((game) => game.id === old.id) && !adminIds.has(old.id)) statements.push(db.prepare('DELETE FROM games WHERE id = ?').bind(old.id))
  }
  if (existing) statements.push(weekStatement)
  await db.batch(statements)
  return (await getWeek(db, start))!
}

function resultFromNhl(raw: NhlGame, current: Game): { state: Game['state']; awayScore: number | null; homeScore: number | null; winner: Side | null } {
  const scheduleState = (raw.gameScheduleState ?? '').toUpperCase()
  const movedOutside = raw.startTimeUTC && !isInWeekend(easternDate(raw.startTimeUTC), weekendStartAt(current.startUtc))
  if (['PPD', 'CNCL', 'CANCELLED'].includes(scheduleState) || movedOutside) {
    return { state: 'void', awayScore: null, homeScore: null, winner: null }
  }
  const away = raw.awayTeam.score
  const home = raw.homeTeam.score
  if (['OFF', 'FINAL'].includes(raw.gameState) && Number.isInteger(away) && Number.isInteger(home) && away !== home) {
    return { state: 'final', awayScore: away!, homeScore: home!, winner: away! > home! ? 'away' : 'home' }
  }
  return { state: ['LIVE', 'CRIT'].includes(raw.gameState) ? 'live' : 'scheduled', awayScore: away ?? null, homeScore: home ?? null, winner: null }
}

async function syncResults(db: D1Database, start: string): Promise<Weekend> {
  const week = await getWeek(db, start)
  if (!week || week.status === 'final' || !week.games.length) return week!
  const days = [start, addDays(start, 1), addDays(start, 2)]
  const responses = await Promise.all(days.map((date) => nhl(`score/${date}`))) as { games?: NhlGame[] }[]
  if (responses.some((response) => !Array.isArray(response.games))) throw new Error('NHL score response is invalid')
  const scores = new Map(responses.flatMap((response) => response.games ?? []).map((game) => [game.id, game]))
  const statements: D1PreparedStatement[] = []
  for (const game of week.games) {
    let source = scores.get(game.id)
    if (!source && game.state !== 'final' && game.state !== 'void') {
      try { source = await nhl(`gamecenter/${game.id}/landing`) as NhlGame } catch { /* retry on next run */ }
    }
    if (!source) continue
    const result = resultFromNhl(source, game)
    // Admin corrections remain authoritative until another explicit correction.
    const isAdmin = await db.prepare('SELECT source FROM games WHERE id = ?').bind(game.id).first<{ source: string }>()
    if (isAdmin?.source === 'admin') continue
    statements.push(db.prepare('UPDATE games SET state=?, away_score=?, home_score=?, winner=? WHERE id=?')
      .bind(result.state, result.awayScore, result.homeScore, result.winner, game.id))
  }
  statements.push(db.prepare('UPDATE weekends SET last_result_sync=? WHERE start_date=?').bind(nowIso(), start))
  await db.batch(statements)
  const updated = (await getWeek(db, start))!
  if (updated.games.length && updated.games.every((game) => game.state === 'final' || game.state === 'void')) {
    await finalize(db, start)
    return (await getWeek(db, start))!
  }
  return updated
}

async function finalize(db: D1Database, start: string): Promise<void> {
  const week = await getWeek(db, start)
  if (!week || !hasEntryDeadlinePassed(week)) throw new Error('Entry deadline has not passed')
  if (!week.games.length || week.games.some((game) => game.state !== 'final' && game.state !== 'void')) {
    throw new Error('Every game must be final or void before publishing standings')
  }
  const entries = await db.prepare('SELECT id, clerk_id FROM entries WHERE weekend_start = ?').bind(start).all<{ id: number; clerk_id: string }>()
  const scores: { clerkId: string; points: number; correct: number }[] = []
  for (const entry of entries.results) {
    const rows = await db.prepare('SELECT game_id, side, confidence FROM picks WHERE entry_id = ?').bind(entry.id).all<{ game_id: number; side: Side; confidence: number }>()
    const picks = rows.results.map((row) => ({ gameId: row.game_id, side: row.side, confidence: row.confidence }))
    if (validatePicks(picks, week.games).length) continue
    scores.push({ clerkId: entry.clerk_id, ...scoreEntry(picks, week.games) })
  }
  const ranked = rankScores(scores)
  const statements: D1PreparedStatement[] = [db.prepare('DELETE FROM standings WHERE weekend_start = ?').bind(start)]
  for (const row of ranked) {
    statements.push(db.prepare('INSERT INTO standings (weekend_start, clerk_id, points, correct, rank) VALUES (?, ?, ?, ?, ?)')
      .bind(start, row.clerkId, row.points, row.correct, row.rank))
  }
  statements.push(db.prepare("UPDATE weekends SET status='final', finalized_at=? WHERE start_date=?").bind(nowIso(), start))
  await db.batch(statements)
}

async function auth(request: Request, env: Env): Promise<{ userId: string; username: string | null } | null> {
  if (!env.CLERK_PUBLISHABLE_KEY || !env.CLERK_SECRET_KEY) throw new Error('Clerk is not configured')
  const client = createClerkClient({ publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY })
  const state = await client.authenticateRequest(request, { authorizedParties: [new URL(request.url).origin], acceptsToken: 'session_token' })
  const userId = state.toAuth()?.userId
  if (!state.isAuthenticated || !userId) return null
  const user = await client.users.getUser(userId)
  return { userId, username: user.username }
}

async function savePlayer(db: D1Database, user: { userId: string; username: string | null }): Promise<boolean> {
  if (!user.username) return false
  await db.prepare('INSERT INTO players (clerk_id, username, updated_at) VALUES (?, ?, ?) ON CONFLICT(clerk_id) DO UPDATE SET username=excluded.username, updated_at=excluded.updated_at')
    .bind(user.userId, user.username, nowIso()).run()
  return true
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const start = url.searchParams.get('start')
  if (path === '/api/me' && request.method === 'GET') {
    const user = await auth(request, env)
    if (!user) return error('Sign in required', 401)
    await savePlayer(env.DB, user)
    return json({ username: user.username, isAdmin: !!env.ADMIN_CLERK_USER_ID && user.userId === env.ADMIN_CLERK_USER_ID })
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
      const nextWeek = await getWeek(env.DB, nextStart) ?? await syncSchedule(env.DB, nextStart)
      if (nextWeek.games.length) week = nextWeek
    }
    return json({ week })
  }
  if (path === '/api/weeks' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT start_date, season, status, lock_at, finalized_at FROM weekends WHERE EXISTS (SELECT 1 FROM games WHERE games.weekend_start=weekends.start_date) ORDER BY start_date DESC LIMIT 24').all()
    return json({ weeks: rows.results })
  }
  if (path === '/api/entrants' && request.method === 'GET') {
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const rows = await env.DB.prepare('SELECT p.username FROM entries e JOIN players p ON p.clerk_id=e.clerk_id WHERE e.weekend_start=? ORDER BY p.username COLLATE NOCASE').bind(start).all<{ username: string }>()
    return json({ entrants: rows.results.map((row) => row.username) })
  }
  if (path === '/api/standings' && request.method === 'GET') {
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, start)
    if (!week || !hasEntryDeadlinePassed(week) || week.status !== 'final') return json({ standings: [] })
    const rows = await env.DB.prepare('SELECT p.username, s.points, s.correct, s.rank FROM standings s JOIN players p ON p.clerk_id=s.clerk_id WHERE s.weekend_start=? ORDER BY s.rank, p.username').bind(start).all()
    return json({ standings: rows.results })
  }
  if (path === '/api/season' && request.method === 'GET') {
    const season = url.searchParams.get('season')
    if (!season || !/^\d{4}-\d{2}$/.test(season)) return error('Invalid season', 400)
    const rows = await env.DB.prepare(`SELECT p.username, SUM(s.points) AS points, SUM(s.correct) AS correct
      FROM standings s JOIN weekends w ON w.start_date=s.weekend_start JOIN players p ON p.clerk_id=s.clerk_id
      WHERE w.season=? AND w.status='final' GROUP BY s.clerk_id ORDER BY points DESC, p.username`).bind(season).all<{ username: string; points: number; correct: number }>()
    return json({ standings: rankScores(rows.results) })
  }
  if (path === '/api/entry' && (request.method === 'GET' || request.method === 'PUT')) {
    const user = await auth(request, env)
    if (!user) return error('Sign in to manage your entry', 401)
    if (request.method === 'GET') {
      if (!validStart(start)) return error('Invalid weekend date', 400)
      const row = await env.DB.prepare('SELECT id, submitted_at, updated_at FROM entries WHERE weekend_start=? AND clerk_id=?').bind(start, user.userId).first<{ id: number; submitted_at: string; updated_at: string }>()
      if (!row) return json({ entry: null })
      const picks = await env.DB.prepare('SELECT game_id, side, confidence FROM picks WHERE entry_id=?').bind(row.id).all<{ game_id: number; side: Side; confidence: number }>()
      const entry: Entry = { submittedAt: row.submitted_at, updatedAt: row.updated_at, picks: picks.results.map((pick) => ({ gameId: pick.game_id, side: pick.side, confidence: pick.confidence })) }
      return json({ entry })
    }
    const body = await request.json() as { startDate?: string; picks?: Pick[] }
    const bodyStart = body.startDate ?? null
    if (!validStart(bodyStart) || !Array.isArray(body.picks)) return error('Invalid entry', 400)
    const week = await getWeek(env.DB, bodyStart)
    if (!week || !isEntryOpen(week)) return error('Entries are closed', 409)
    const errors = validatePicks(body.picks, week.games)
    if (errors.length) return json({ errors }, 400)
    if (!(await savePlayer(env.DB, user))) return error('Set a Clerk username before entering', 422)
    const timestamp = nowIso()
    const statements: D1PreparedStatement[] = [env.DB.prepare(`INSERT INTO entries (weekend_start, clerk_id, submitted_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(weekend_start, clerk_id) DO UPDATE SET updated_at=excluded.updated_at`).bind(bodyStart, user.userId, timestamp, timestamp)]
    statements.push(env.DB.prepare('DELETE FROM picks WHERE entry_id=(SELECT id FROM entries WHERE weekend_start=? AND clerk_id=?)').bind(bodyStart, user.userId))
    for (const pick of body.picks) statements.push(env.DB.prepare('INSERT INTO picks (entry_id, game_id, side, confidence) VALUES ((SELECT id FROM entries WHERE weekend_start=? AND clerk_id=?), ?, ?, ?)')
      .bind(bodyStart, user.userId, pick.gameId, pick.side, pick.confidence))
    await env.DB.batch(statements)
    return json({ saved: true, updatedAt: timestamp })
  }
  if (path === '/api/picks' && request.method === 'GET') {
    const user = await auth(request, env)
    if (!user) return error('Sign in to view players’ picks', 401)
    if (!validStart(start)) return error('Invalid weekend date', 400)
    const week = await getWeek(env.DB, start)
    if (!week || !hasEntryDeadlinePassed(week)) return error('Picks are hidden until the entry deadline', 403)
    const rows = await env.DB.prepare(`SELECT p.username, k.game_id, k.side, k.confidence FROM picks k
      JOIN entries e ON e.id=k.entry_id JOIN players p ON p.clerk_id=e.clerk_id
      WHERE e.weekend_start=? ORDER BY p.username, k.game_id`).bind(start).all()
    return json({ picks: rows.results })
  }
  if (path.startsWith('/api/admin/') && request.method === 'POST') {
    const user = await auth(request, env)
    if (!user || !env.ADMIN_CLERK_USER_ID || user.userId !== env.ADMIN_CLERK_USER_ID) return error('Admin access required', 403)
    const body = await request.json() as Record<string, unknown>
    const selected = body.startDate
    if (typeof selected !== 'string' || !validStart(selected)) return error('Invalid weekend date', 400)
    if (path === '/api/admin/sync') return json({ week: await syncSchedule(env.DB, selected) })
    if (path === '/api/admin/finalize') {
      await finalize(env.DB, selected)
      return json({ week: await getWeek(env.DB, selected) })
    }
    if (path === '/api/admin/game') {
      const gameId = Number(body.gameId)
      let week = await getWeek(env.DB, selected)
      if (!Number.isInteger(gameId) || gameId <= 0) return error('Invalid game', 400)
      const current = week?.games.find((game) => game.id === gameId)
      if (current && (body.state === 'final' || body.state === 'void')) {
        const away = Number(body.awayScore)
        const home = Number(body.homeScore)
        if (body.state === 'final' && (!Number.isInteger(away) || !Number.isInteger(home) || away === home || away < 0 || home < 0)) return error('Enter different nonnegative final scores', 400)
        await env.DB.prepare("UPDATE games SET state=?, away_score=?, home_score=?, winner=?, source='admin' WHERE id=?")
          .bind(body.state, body.state === 'final' ? away : null, body.state === 'final' ? home : null, body.state === 'final' ? (away > home ? 'away' : 'home') : null, gameId).run()
        const after = (await getWeek(env.DB, selected))!
        if (after.games.every((game) => game.state === 'final' || game.state === 'void')) await finalize(env.DB, selected)
        return json({ week: await getWeek(env.DB, selected) })
      }
      if (body.state === 'final' || body.state === 'void') return error('Game not found', 404)
      if (week && week.status !== 'open') return error('The game list is frozen', 409)
      const startUtc = String(body.startUtc ?? '')
      const awayCode = String(body.awayCode ?? '').toUpperCase()
      const homeCode = String(body.homeCode ?? '').toUpperCase()
      const awayName = String(body.awayName ?? '').trim()
      const homeName = String(body.homeName ?? '').trim()
      if (!Number.isFinite(Date.parse(startUtc)) || !isInWeekend(easternDate(startUtc), selected) || !/^[A-Z]{2,4}$/.test(awayCode) || !/^[A-Z]{2,4}$/.test(homeCode) || !awayName || !homeName) return error('Complete the matchup with a weekend start time', 400)
      const belongsTo = await env.DB.prepare('SELECT weekend_start FROM games WHERE id=?').bind(gameId).first<{ weekend_start: string }>()
      if (belongsTo && belongsTo.weekend_start !== selected) return error('That NHL game ID belongs to another weekend', 409)
      const statements: D1PreparedStatement[] = []
      if (!week) {
        statements.push(env.DB.prepare('INSERT INTO weekends (start_date, season) VALUES (?, ?)').bind(selected, seasonFor(selected)))
      }
      statements.push(env.DB.prepare('DELETE FROM excluded_games WHERE weekend_start=? AND game_id=?').bind(selected, gameId))
      statements.push(env.DB.prepare(`INSERT INTO games (id, weekend_start, start_utc, eastern_date, away_code, away_name, away_logo, home_code, home_name, home_logo, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin') ON CONFLICT(id) DO UPDATE SET start_utc=excluded.start_utc, eastern_date=excluded.eastern_date,
        away_code=excluded.away_code, away_name=excluded.away_name, away_logo=excluded.away_logo,
        home_code=excluded.home_code, home_name=excluded.home_name, home_logo=excluded.home_logo, source='admin'`)
        .bind(gameId, selected, startUtc, easternDate(startUtc), awayCode, awayName, `https://assets.nhle.com/logos/nhl/svg/${awayCode}_light.svg`, homeCode, homeName, `https://assets.nhle.com/logos/nhl/svg/${homeCode}_light.svg`))
      statements.push(env.DB.prepare('UPDATE weekends SET lock_at=(SELECT MIN(start_utc) FROM games WHERE weekend_start=?) WHERE start_date=?').bind(selected, selected))
      await env.DB.batch(statements)
      week = (await getWeek(env.DB, selected))!
      return json({ week: await getWeek(env.DB, selected) })
    }
    if (path === '/api/admin/remove-game') {
      const week = await getWeek(env.DB, selected)
      const gameId = Number(body.gameId)
      if (!week || week.status !== 'open' || !week.games.some((game) => game.id === gameId)) return error('Game list is locked or game not found', 409)
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO excluded_games (weekend_start, game_id) VALUES (?, ?)').bind(selected, gameId),
        env.DB.prepare('DELETE FROM games WHERE id=? AND weekend_start=?').bind(gameId, selected),
        env.DB.prepare('UPDATE weekends SET lock_at=(SELECT MIN(start_utc) FROM games WHERE weekend_start=?) WHERE start_date=?').bind(selected, selected),
      ])
      return json({ week: await getWeek(env.DB, selected) })
    }
  }
  return error('Not found', 404)
}

async function scheduled(env: Env): Promise<void> {
  const current = weekendStartAt(Date.now())
  const next = addDays(current, 7)
  for (const start of [current, next]) {
    const week = await getWeek(env.DB, start)
    const stale = !week || !(await env.DB.prepare('SELECT last_schedule_sync FROM weekends WHERE start_date=?').bind(start).first<{ last_schedule_sync: string | null }>())?.last_schedule_sync
    if (week?.status === 'open' && (stale || new Date().getUTCHours() === 12 && new Date().getUTCMinutes() < 15)) {
      try { await syncSchedule(env.DB, start) } catch (cause) { console.error(`Schedule sync failed for ${start}`, cause) }
    } else if (!week) {
      try { await syncSchedule(env.DB, start) } catch (cause) { console.error(`Schedule sync failed for ${start}`, cause) }
    }
  }
  const pending = await env.DB.prepare("SELECT start_date FROM weekends WHERE status!='final' AND lock_at IS NOT NULL AND lock_at <= ? ORDER BY start_date DESC LIMIT 4")
    .bind(nowIso()).all<{ start_date: string }>()
  for (const row of pending.results) {
    try { await syncResults(env.DB, row.start_date) } catch (cause) { console.error(`Result sync failed for ${row.start_date}`, cause) }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await api(request, env) }
    catch (cause) { console.error(cause); return error(cause instanceof Error ? cause.message : 'Unexpected server error', 500) }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(env))
  },
} satisfies ExportedHandler<Env>
