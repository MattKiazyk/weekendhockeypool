import type { Game, LeagueId, Side, Weekend } from '../src/lib/pool'
import { getNhlRecords, getNhlResults, getNhlSchedule } from './nhl'
import { getPwhlRecords, getPwhlResults, getPwhlSchedule } from './pwhl'
import { getNflRecords, getNflResults, getNflSchedule } from './nfl'

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
  records(season: string): Promise<Map<string, string>>
}

const feeds: Record<LeagueId, LeagueFeed> = {
  nhl: { schedule: getNhlSchedule, results: getNhlResults, records: getNhlRecords },
  pwhl: { schedule: getPwhlSchedule, results: getPwhlResults, records: getPwhlRecords },
  nfl: { schedule: getNflSchedule, results: getNflResults, records: getNflRecords },
}

export function feedFor(league: LeagueId): LeagueFeed {
  return feeds[league]
}
