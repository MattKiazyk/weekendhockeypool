export type Side = 'away' | 'home'
export type LeagueId = 'nhl' | 'pwhl' | 'nfl'
export type GameState = 'scheduled' | 'live' | 'final' | 'void'
export type WeekendStatus = 'open' | 'locked' | 'final'

export interface Team {
  code: string
  name: string
  logo: string | null
  record?: string | null
}

export interface Game {
  id: number
  sourceId: number
  startUtc: string
  easternDate: string
  away: Team
  home: Team
  state: GameState
  awayScore: number | null
  homeScore: number | null
  winner: Side | null
}

export interface Weekend {
  league: LeagueId
  startDate: string
  season: string
  weekNumber: number | null
  opensAt: string
  lockAt: string | null
  status: WeekendStatus
  finalizedAt: string | null
  games: Game[]
}

export interface Pick {
  gameId: number
  side: Side
  confidence: number
}

export interface Entry {
  picks: Pick[]
  submittedAt: string
  updatedAt: string
}

export interface Standing {
  username: string
  points: number
  correct: number
  rank: number
}

export interface PublicPick {
  username: string
  game_id: number
  side: Side
  confidence: number
}

export interface WeekListing {
  league: LeagueId
  start_date: string
  season: string
  week_number: number | null
  status: WeekendStatus
}

export interface CombinedStanding extends Standing {
  nhlPoints: number | null
  pwhlPoints: number | null
  nflPoints: number | null
}

export function isWeekendComplete(week: Weekend): boolean {
  return (
    week.games.length > 0 &&
    week.games.every((game) => game.state === 'final' || game.state === 'void')
  )
}

export function confidenceNumbers(count: number): number[] {
  return Array.from({ length: count }, (_, index) => count - index)
}

export function updatePick(picks: Pick[], next: Pick): Pick[] {
  const current = picks.find((pick) => pick.gameId === next.gameId)
  return [
    ...picks
      .filter((pick) => pick.gameId !== next.gameId)
      .map((pick) =>
        next.confidence > 0 && pick.confidence === next.confidence
          ? { ...pick, confidence: current?.confidence ?? 0 }
          : pick,
      ),
    next,
  ]
}

export function easternDate(value: string | number | Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function easternTimeAt(date: string, hour: number): string {
  const noon = new Date(`${date}T12:00:00Z`)
  const zone = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(noon)
    .find((part) => part.type === 'timeZoneName')?.value
  const offset = /^GMT([+-]\d{1,2})$/.exec(zone ?? '')
  if (!offset) throw new Error('Could not determine Eastern time offset')
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCHours(hour - Number(offset[1]))
  return result.toISOString()
}

export function weekendStartAt(value: string | number | Date): string {
  const date = easternDate(value)
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const offset = weekday === 6 ? -1 : weekday === 0 ? -2 : 5 - weekday
  return addDays(date, offset)
}

export function isInWeekend(easternGameDate: string, startDate: string): boolean {
  return [startDate, addDays(startDate, 1), addDays(startDate, 2)].includes(easternGameDate)
}

export function seasonFor(startDate: string): string {
  const year = Number(startDate.slice(0, 4))
  const month = Number(startDate.slice(5, 7))
  const first = month >= 7 ? year : year - 1
  return `${first}-${String(first + 1).slice(2)}`
}

export function lockTime(games: Game[]): string | null {
  if (!games.length) return null
  return games.map((game) => game.startUtc).sort()[0]
}

export function entryOpensAt(startDate: string): string {
  return easternTimeAt(addDays(startDate, -4), 8)
}

export function isEntryOpen(
  week: { status: WeekendStatus; opensAt: string; lockAt: string | null },
  now = Date.now(),
): boolean {
  return (
    week.status === 'open' &&
    Number.isFinite(Date.parse(week.opensAt)) &&
    now >= Date.parse(week.opensAt) &&
    !!week.lockAt &&
    now < Date.parse(week.lockAt)
  )
}

export function hasEntryDeadlinePassed(week: Weekend, now = Date.now()): boolean {
  return !!week.lockAt && Number.isFinite(Date.parse(week.lockAt)) && now >= Date.parse(week.lockAt)
}

export function validatePicks(picks: Pick[], games: Game[]): string[] {
  if (picks.some((pick) => !pick || typeof pick !== 'object')) {
    return ['Each pick must include a game, side, and confidence number.']
  }
  const errors: string[] = []
  const gameIds = new Set(games.map((game) => game.id))
  if (picks.length !== games.length || games.length === 0) {
    errors.push(`Pick one winner for all ${games.length} games.`)
  }
  if (
    new Set(picks.map((pick) => pick.gameId)).size !== picks.length ||
    picks.some((pick) => !gameIds.has(pick.gameId))
  ) {
    errors.push('Each pick must match a different game in this week.')
  }
  if (picks.some((pick) => pick.side !== 'away' && pick.side !== 'home')) {
    errors.push('Choose exactly one side for each game.')
  }
  const values = picks.map((pick) => pick.confidence)
  if (
    new Set(values).size !== games.length ||
    values.some((value) => !Number.isInteger(value) || value < 1 || value > games.length)
  ) {
    errors.push(`Use each confidence number from 1 to ${games.length} once.`)
  }
  return errors
}

export function scoreEntry(picks: Pick[], games: Game[]): { points: number; correct: number } {
  const byId = new Map(games.map((game) => [game.id, game]))
  let points = 0
  let correct = 0
  for (const pick of picks) {
    const game = byId.get(pick.gameId)
    if (game?.state === 'final' && game.winner === pick.side) {
      points += pick.confidence
      correct++
    }
  }
  return { points, correct }
}

export function rankScores<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  let rank = 0
  return [...rows]
    .sort((a, b) => b.points - a.points)
    .map((row, index, sorted) => {
      if (index === 0 || sorted[index - 1].points !== row.points) rank = index + 1
      return { ...row, rank }
    })
}
