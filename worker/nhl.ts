import {
  addDays,
  easternDate,
  isInWeekend,
  seasonFor,
  weekendStartAt,
  type Game,
  type Side,
  type Weekend,
} from '../src/lib/pool'
import type { GameResult } from './feeds'

type NhlTeam = {
  abbrev: string
  logo?: string
  placeName?: { default?: string }
  commonName?: { default?: string }
  name?: { default?: string }
  score?: number
}
export type NhlGame = {
  id: number
  gameType: number
  startTimeUTC: string
  gameState: string
  gameScheduleState?: string
  awayTeam: NhlTeam
  homeTeam: NhlTeam
}

export async function nhl(path: string): Promise<unknown> {
  const response = await fetch(`https://api-web.nhle.com/v1/${path}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (compatible; WeekendPools/1.0)',
    },
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

export function gameFromNhl(raw: NhlGame): Game {
  return {
    id: raw.id,
    sourceId: raw.id,
    startUtc: raw.startTimeUTC,
    easternDate: easternDate(raw.startTimeUTC),
    away: {
      code: raw.awayTeam.abbrev,
      name: teamName(raw.awayTeam),
      logo: raw.awayTeam.logo ?? null,
    },
    home: {
      code: raw.homeTeam.abbrev,
      name: teamName(raw.homeTeam),
      logo: raw.homeTeam.logo ?? null,
    },
    state: 'scheduled',
    awayScore: null,
    homeScore: null,
    winner: null,
  }
}

export async function getNhlSchedule(start: string): Promise<{ games: Game[]; season: string }> {
  const feed = (await nhl(`schedule/${start}`)) as {
    gameWeek?: { date: string; games: NhlGame[] }[]
  }
  if (!Array.isArray(feed.gameWeek)) throw new Error('NHL schedule response is invalid')
  return {
    games: feed.gameWeek
      .flatMap((day) => day.games ?? [])
      .filter((game) => game.gameType === 2 && isInWeekend(easternDate(game.startTimeUTC), start))
      .map(gameFromNhl),
    season: seasonFor(start),
  }
}

export async function getNhlRecords(season: string): Promise<Map<string, string>> {
  const body = (await nhl('standings/now')) as {
    standings?: {
      teamAbbrev?: { default?: string }
      seasonId?: number
      wins?: number
      losses?: number
      otLosses?: number
    }[]
  }
  if (!Array.isArray(body.standings)) throw new Error('NHL standings response is invalid')
  const seasonId = Number(`${season.slice(0, 4)}20${season.slice(5)}`)
  const records = new Map<string, string>()
  for (const row of body.standings) {
    if (row.seasonId !== seasonId) throw new Error('NHL standings season does not match')
    if (
      !row.teamAbbrev?.default ||
      ![row.wins, row.losses, row.otLosses].every((count) => Number.isInteger(count) && count! >= 0)
    )
      throw new Error('NHL team record is invalid')
    records.set(row.teamAbbrev.default, `${row.wins}-${row.losses}-${row.otLosses}`)
  }
  if (!records.size) throw new Error('NHL standings are empty')
  return records
}

export async function getNhlResults(week: Weekend): Promise<Map<number, GameResult>> {
  const days = [week.startDate, addDays(week.startDate, 1), addDays(week.startDate, 2)]
  const responses = (await Promise.all(days.map((date) => nhl(`score/${date}`)))) as {
    games?: NhlGame[]
  }[]
  if (responses.some((response) => !Array.isArray(response.games)))
    throw new Error('NHL score response is invalid')
  const scores = new Map(
    responses.flatMap((response) => response.games ?? []).map((game) => [game.id, game]),
  )
  const results = new Map<number, GameResult>()
  for (const game of week.games) {
    let source = scores.get(game.sourceId)
    if (!source && game.state !== 'final' && game.state !== 'void') {
      try {
        source = (await nhl(`gamecenter/${game.sourceId}/landing`)) as NhlGame
      } catch {
        /* Retry on the next run. */
      }
    }
    if (source) results.set(game.sourceId, resultFromNhl(source, game))
  }
  return results
}

export function resultFromNhl(
  raw: NhlGame,
  current: Game,
): {
  state: Game['state']
  awayScore: number | null
  homeScore: number | null
  winner: Side | null
} {
  const scheduleState = (raw.gameScheduleState ?? '').toUpperCase()
  const movedOutside =
    raw.startTimeUTC &&
    !isInWeekend(easternDate(raw.startTimeUTC), weekendStartAt(current.startUtc))
  if (['PPD', 'CNCL', 'CANCELLED'].includes(scheduleState) || movedOutside) {
    return { state: 'void', awayScore: null, homeScore: null, winner: null }
  }
  const away = raw.awayTeam.score
  const home = raw.homeTeam.score
  if (
    ['OFF', 'FINAL'].includes(raw.gameState) &&
    Number.isInteger(away) &&
    Number.isInteger(home) &&
    away !== home
  ) {
    return {
      state: 'final',
      awayScore: away!,
      homeScore: home!,
      winner: away! > home! ? 'away' : 'home',
    }
  }
  return {
    state: ['LIVE', 'CRIT'].includes(raw.gameState) ? 'live' : 'scheduled',
    awayScore: away ?? null,
    homeScore: home ?? null,
    winner: null,
  }
}
