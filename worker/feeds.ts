import type { Game, LeagueId, Side, Weekend } from '../src/lib/pool'
import { getNhlResults, getNhlSchedule } from './nhl'
import { getPwhlResults, getPwhlSchedule } from './pwhl'

export interface GameResult {
  state: Game['state']
  awayScore: number | null
  homeScore: number | null
  winner: Side | null
}

interface LeagueFeed {
  schedule(start: string): Promise<{ games: Game[]; season: string }>
  results(week: Weekend): Promise<Map<number, GameResult>>
}

const feeds: Record<LeagueId, LeagueFeed> = {
  nhl: { schedule: getNhlSchedule, results: getNhlResults },
  pwhl: { schedule: getPwhlSchedule, results: getPwhlResults },
}

export function feedFor(league: LeagueId): LeagueFeed {
  return feeds[league]
}
