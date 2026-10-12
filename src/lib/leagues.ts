import { seasonFor, type LeagueId } from './pool'

export const leagues: { id: LeagueId; label: string; name: string; icon: string }[] = [
  { id: 'nhl', label: 'NHL', name: 'National Hockey League', icon: '/leagues/nhl.svg' },
  {
    id: 'pwhl',
    label: 'PWHL',
    name: 'Professional Women’s Hockey League',
    icon: '/leagues/pwhl-white.svg',
  },
  { id: 'nfl', label: 'NFL', name: 'National Football League', icon: '/leagues/nfl.png' },
  { id: 'cfl', label: 'CFL', name: 'Canadian Football League', icon: '/leagues/cfl.svg' },
]

export function isLeague(value: unknown): value is LeagueId {
  return value === 'nhl' || value === 'pwhl' || value === 'nfl' || value === 'cfl'
}

export function leagueLabel(league: LeagueId): string {
  return leagues.find((item) => item.id === league)!.label
}

export function usesNumberedWeeks(league: LeagueId): boolean {
  return league === 'nfl' || league === 'cfl'
}
export function leagueSeasonFor(league: LeagueId, date: string): string {
  if (league !== 'cfl') return seasonFor(date)
  const year = Number(date.slice(0, 4))
  return `${year}-${String(year + 1).slice(-2)}`
}
