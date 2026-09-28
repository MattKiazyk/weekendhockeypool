import type { LeagueId } from './pool'

export const leagues: { id: LeagueId; label: string; name: string; icon: string }[] = [
  { id: 'nhl', label: 'NHL', name: 'National Hockey League', icon: '/leagues/nhl.svg' },
  {
    id: 'pwhl',
    label: 'PWHL',
    name: 'Professional Women’s Hockey League',
    icon: '/leagues/pwhl.svg',
  },
]

export function isLeague(value: unknown): value is LeagueId {
  return value === 'nhl' || value === 'pwhl'
}

export function leagueLabel(league: LeagueId): string {
  return leagues.find((item) => item.id === league)!.label
}
