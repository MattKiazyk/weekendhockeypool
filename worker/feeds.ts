import type { Game, LeagueId, Side, Weekend } from '../src/lib/pool'
import { getNhlResults, getNhlSchedule } from './nhl'
import { getPwhlResults, getPwhlSchedule } from './pwhl'
import { getNflResults, getNflSchedule } from './nfl'

export interface GameResult {
  state: Game['state']
  awayScore: number | null
  homeScore: number | null
  winner: Side | null
}

export interface WeekSchedule {
  games: Game[]
  season: string
  weekNumber?: number
  opensAt?: string
}

interface LeagueFeed {
  schedule(start: string): Promise<WeekSchedule>
  results(week: Weekend): Promise<Map<number, GameResult>>
}

const feeds: Record<LeagueId, LeagueFeed> = {
  nhl: { schedule: getNhlSchedule, results: getNhlResults },
  pwhl: { schedule: getPwhlSchedule, results: getPwhlResults },
  nfl: { schedule: getNflSchedule, results: getNflResults },
}

export function feedFor(league: LeagueId): LeagueFeed {
  return feeds[league]
}
