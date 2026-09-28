import { easternDate, isInWeekend, weekendStartAt, type Game, type Side } from '../src/lib/pool'

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
      'user-agent': 'Mozilla/5.0 (compatible; WeekendHockeyPool/1.0)',
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
