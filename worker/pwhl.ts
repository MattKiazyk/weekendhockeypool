import {
  easternDate,
  isInWeekend,
  seasonFor,
  weekendStartAt,
  type Game,
  type Weekend,
} from '../src/lib/pool'
import type { GameResult } from './feeds'

interface PwhlSeason {
  season_id: string
  season_name: string
  playoff: string
  start_date: string
  end_date: string
}

interface PwhlTeam {
  id: string
  team_logo_url?: string
}

export interface PwhlGame {
  id: string
  season_id: string
  GameDateISO8601: string
  date_tbd: string
  time_tbd: string
  home_team: string
  visiting_team: string
  home_team_name: string
  home_team_code: string
  visiting_team_name: string
  visiting_team_code: string
  home_goal_count: string
  visiting_goal_count: string
  started: string
  final: string
  game_status: string
  game_type: string
}

async function pwhl(view: string, seasonId?: string): Promise<Record<string, unknown>> {
  const url = new URL('https://lscluster.hockeytech.com/feed/index.php')
  url.search = new URLSearchParams({
    feed: 'modulekit',
    view,
    ...(seasonId ? { season_id: seasonId } : {}),
    key: '446521baf8c38984',
    client_code: 'pwhl',
  }).toString()
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`PWHL feed returned ${response.status}`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !('SiteKit' in body))
    throw new Error('PWHL feed response is invalid')
  const siteKit = (body as { SiteKit: unknown }).SiteKit
  if (!siteKit || typeof siteKit !== 'object' || 'Error' in siteKit || 'error' in siteKit)
    throw new Error('PWHL feed returned an error')
  return siteKit as Record<string, unknown>
}

async function regularSeason(season: string): Promise<PwhlSeason | null> {
  if (season < '2026-27') return null
  const body = await pwhl('seasons')
  if (!Array.isArray(body.Seasons)) throw new Error('PWHL seasons response is invalid')
  return (
    (body.Seasons as PwhlSeason[]).find(
      (item) =>
        item.season_name === `${season} Regular Season` &&
        String(item.playoff) === '0' &&
        /^\d+$/.test(item.season_id),
    ) ?? null
  )
}

async function schedule(seasonId: string): Promise<PwhlGame[]> {
  const body = await pwhl('schedule', seasonId)
  if (!Array.isArray(body.Schedule)) throw new Error('PWHL schedule response is invalid')
  return body.Schedule as PwhlGame[]
}

function startUtc(raw: PwhlGame): string {
  // date_time_played can carry a misleading Z suffix; this field includes the actual offset.
  const date = new Date(raw.GameDateISO8601)
  if (!Number.isFinite(date.getTime()) || !/[+-]\d{2}:\d{2}$/.test(raw.GameDateISO8601))
    throw new Error('PWHL game time is invalid')
  return date.toISOString()
}

function sourceId(raw: PwhlGame): number {
  const id = Number(raw.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('PWHL game ID is invalid')
  return id
}

export function gameFromPwhl(raw: PwhlGame, logos: Map<string, string>): Game {
  const start = startUtc(raw)
  const id = sourceId(raw)
  if (
    !raw.visiting_team_code ||
    !raw.home_team_code ||
    !raw.visiting_team_name ||
    !raw.home_team_name
  )
    throw new Error('PWHL team data is invalid')
  return {
    id,
    sourceId: id,
    startUtc: start,
    easternDate: easternDate(start),
    away: {
      code: raw.visiting_team_code,
      name: raw.visiting_team_name,
      logo: logos.get(raw.visiting_team) ?? null,
    },
    home: {
      code: raw.home_team_code,
      name: raw.home_team_name,
      logo: logos.get(raw.home_team) ?? null,
    },
    state: 'scheduled',
    awayScore: null,
    homeScore: null,
    winner: null,
  }
}

export function resultFromPwhl(raw: PwhlGame, current: Game): GameResult {
  if (raw.date_tbd === '1' || /postpon|cancel|suspend/i.test(raw.game_status))
    return { state: 'void', awayScore: null, homeScore: null, winner: null }
  const movedOutside = !isInWeekend(easternDate(startUtc(raw)), weekendStartAt(current.startUtc))
  if (movedOutside) return { state: 'void', awayScore: null, homeScore: null, winner: null }
  const away = Number(raw.visiting_goal_count)
  const home = Number(raw.home_goal_count)
  if (
    raw.final === '1' &&
    Number.isInteger(away) &&
    Number.isInteger(home) &&
    away >= 0 &&
    home >= 0 &&
    away !== home
  )
    return {
      state: 'final',
      awayScore: away,
      homeScore: home,
      winner: away > home ? 'away' : 'home',
    }
  return {
    state: raw.started === '1' ? 'live' : 'scheduled',
    awayScore: raw.started === '1' && Number.isInteger(away) ? away : null,
    homeScore: raw.started === '1' && Number.isInteger(home) ? home : null,
    winner: null,
  }
}

export async function getPwhlSchedule(start: string): Promise<{ games: Game[]; season: string }> {
  const season = seasonFor(start)
  const selected = await regularSeason(season)
  if (
    !selected ||
    start > selected.end_date ||
    (!isInWeekend(selected.start_date, start) && start < selected.start_date)
  )
    return { games: [], season }
  const rows = await schedule(selected.season_id)
  const eligible = rows.filter(
    (game) =>
      game.date_tbd !== '1' &&
      game.time_tbd !== '1' &&
      (!game.game_type || game.game_type === 'Regular Season') &&
      isInWeekend(easternDate(startUtc(game)), start),
  )
  if (!eligible.length) return { games: [], season }
  const teams = await pwhl('teamsbyseason', selected.season_id)
  if (!Array.isArray(teams.Teamsbyseason)) throw new Error('PWHL teams response is invalid')
  const logos = new Map(
    (teams.Teamsbyseason as PwhlTeam[])
      .filter((team) => team.team_logo_url)
      .map((team) => [team.id, team.team_logo_url!]),
  )
  return { games: eligible.map((game) => gameFromPwhl(game, logos)), season }
}

export async function getPwhlResults(week: Weekend): Promise<Map<number, GameResult>> {
  const selected = await regularSeason(week.season)
  if (!selected) throw new Error('PWHL regular season is unavailable')
  const rows = await schedule(selected.season_id)
  const byId = new Map(rows.map((row) => [sourceId(row), row]))
  const results = new Map<number, GameResult>()
  for (const game of week.games) {
    const raw = byId.get(game.sourceId)
    if (raw) results.set(game.sourceId, resultFromPwhl(raw, game))
  }
  return results
}
