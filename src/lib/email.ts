import { isLeague } from './leagues'
import type { LeagueId } from './pool'

export type EmailPreferences = Record<LeagueId, { reminder: boolean; recap: boolean }>
export interface EmailSettings {
  email: string | null
  verified: boolean
  preferences: EmailPreferences
}
export function emptyEmailPreferences(): EmailPreferences {
  return {
    nhl: { reminder: false, recap: false },
    pwhl: { reminder: false, recap: false },
    nfl: { reminder: false, recap: false },
  }
}
export function defaultEmailPreferences(): EmailPreferences {
  return {
    nhl: { reminder: true, recap: true },
    pwhl: { reminder: true, recap: true },
    nfl: { reminder: true, recap: true },
  }
}
export function isEmailPreferences(value: unknown): value is EmailPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length === 3 &&
    entries.every(
      ([league, settings]) =>
        isLeague(league) &&
        settings &&
        typeof settings === 'object' &&
        !Array.isArray(settings) &&
        Object.keys(settings).length === 2 &&
        typeof settings.reminder === 'boolean' &&
        typeof settings.recap === 'boolean',
    )
  )
}
