import type { LeagueId, Weekend, WeekendStatus } from '../lib/pool'
import { formatSlateDates, formatTime } from '../lib/format'

export default function WeekHero({
  week,
  league,
  status,
}: {
  week: Weekend | null
  league: LeagueId
  status: WeekendStatus
}) {
  const count = week?.games.length ?? 0
  return (
    <section className="hero slate-hero">
      <div className="hero-lines" aria-hidden="true" />
      <div className="hero-content">
        <div className="eyebrow">
          <span className="live-dot" /> {league.toUpperCase()} REGULAR SEASON{' '}
          <span className="eyebrow-divider">/</span> {week?.season ?? '2026–27'}
        </div>
        <div className="slate-summary">
          <div className="slate-date">
            <span className="slate-label">FRIDAY–SUNDAY · WEEKEND SLATE</span>
            <h1>{week ? formatSlateDates(week.startDate) : 'NEXT WEEKEND'}</h1>
          </div>
          <div className="slate-stat">
            <strong>{count}</strong>
            <span>GAMES</span>
          </div>
          <div className="slate-stat slate-deadline">
            <strong>
              {status === 'final'
                ? 'FINAL'
                : status === 'locked'
                  ? 'LOCKED'
                  : week?.lockAt
                    ? formatTime(week.lockAt)
                    : 'TBD'}
            </strong>
            <span>{status === 'final' ? 'RESULTS' : 'ENTRY DEADLINE'}</span>
          </div>
        </div>
      </div>
      <div className="hero-number" aria-hidden="true">
        {String(count).padStart(2, '0')}
      </div>
    </section>
  )
}
