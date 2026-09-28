import type { LeagueId, Weekend, WeekendStatus } from '../lib/pool'
import { formatSlateDates, formatTime } from '../lib/format'

export default function WeekHero({
  week,
  league,
  status,
  season,
  seasonOnly = false,
}: {
  week: Weekend | null
  league: LeagueId
  status: WeekendStatus | 'upcoming'
  season?: string
  seasonOnly?: boolean
}) {
  const count = week?.games.length ?? 0
  return (
    <section className="hero slate-hero">
      <div className="hero-lines" aria-hidden="true" />
      <div className="hero-content">
        <div className="eyebrow">
          <span className="live-dot" /> {league.toUpperCase()} REGULAR SEASON{' '}
          <span className="eyebrow-divider">/</span> {season ?? week?.season ?? '2026–27'}
        </div>
        <div className="slate-summary">
          <div className="slate-date">
            <span className="slate-label">
              {seasonOnly ? 'CURRENT SEASON · STANDINGS' : 'FRIDAY–SUNDAY · WEEKEND SLATE'}
            </span>
            <h1>
              {seasonOnly ? season : week ? formatSlateDates(week.startDate) : 'NEXT WEEKEND'}
            </h1>
          </div>
          {!seasonOnly && (
            <div className="slate-stat">
              <strong>{count}</strong>
              <span>GAMES</span>
            </div>
          )}
          {!seasonOnly && (
            <div className="slate-stat slate-deadline">
              <strong>
                {status === 'final'
                  ? 'FINAL'
                  : status === 'locked'
                    ? 'LOCKED'
                    : status === 'upcoming' && week
                      ? formatTime(week.opensAt)
                      : week?.lockAt
                        ? formatTime(week.lockAt)
                        : 'TBD'}
              </strong>
              <span>
                {status === 'final'
                  ? 'RESULTS'
                  : status === 'upcoming'
                    ? 'PICKS OPEN MONDAY'
                    : 'ENTRY DEADLINE'}
              </span>
            </div>
          )}
        </div>
      </div>
      {!seasonOnly && (
        <div className="hero-number" aria-hidden="true">
          {String(count).padStart(2, '0')}
        </div>
      )}
    </section>
  )
}
