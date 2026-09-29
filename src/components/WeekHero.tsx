import {
  easternDate,
  seasonFor,
  type LeagueId,
  type Weekend,
  type WeekendStatus,
} from '../lib/pool'
import { formatSlateDates, formatTime } from '../lib/format'

export default function WeekHero({
  week,
  league,
  status,
  season,
  seasonOnly = false,
  offseason = false,
}: {
  week: Weekend | null
  league: LeagueId
  status: WeekendStatus | 'upcoming'
  season?: string
  seasonOnly?: boolean
  offseason?: boolean
}) {
  const count = week?.games.length ?? 0
  const nfl = league === 'nfl'
  const gameDates = week?.games.map((game) => game.easternDate).sort() ?? []
  const title = seasonOnly
    ? nfl
      ? `${(season ?? week?.season ?? '').slice(0, 4)} SEASON`
      : `${(season ?? week?.season ?? '').replace('-', '–')} SEASON`
    : week
      ? nfl && gameDates.length
        ? formatSlateDates(gameDates[0], gameDates[gameDates.length - 1])
        : formatSlateDates(week.startDate)
      : nfl
        ? offseason
          ? 'NFL OFFSEASON'
          : 'NEXT NFL WEEK'
        : 'NEXT WEEKEND'
  return (
    <section className="hero slate-hero">
      <div className="hero-lines" aria-hidden="true" />
      <div className="hero-content">
        <div className="eyebrow">
          <span className="live-dot" /> {league.toUpperCase()} REGULAR SEASON{' '}
          <span className="eyebrow-divider">/</span>{' '}
          {nfl
            ? (season ?? week?.season ?? seasonFor(easternDate(Date.now()))).slice(0, 4)
            : (season ?? week?.season ?? seasonFor(easternDate(Date.now())))}
        </div>
        <div className="slate-summary">
          <div className="slate-date">
            <span className="slate-label">
              {seasonOnly
                ? 'SEASON STANDINGS'
                : nfl
                  ? week?.weekNumber
                    ? `NFL WEEK ${week.weekNumber} · OFFICIAL SLATE`
                    : 'NFL WEEKLY POOL'
                  : 'FRIDAY–SUNDAY · WEEKEND SLATE'}
            </span>
            <h1>{title}</h1>
          </div>
          {!seasonOnly && (!nfl || week) && (
            <div className="slate-stat">
              <strong>{count}</strong>
              <span>GAMES</span>
            </div>
          )}
          {!seasonOnly && (!nfl || week) && (
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
                    ? `PICKS OPEN ${nfl ? 'TUESDAY' : 'MONDAY'}`
                    : 'ENTRY DEADLINE'}
              </span>
            </div>
          )}
        </div>
      </div>
      {!seasonOnly && (!nfl || week) && (
        <div className="hero-number" aria-hidden="true">
          {String(count).padStart(2, '0')}
        </div>
      )}
    </section>
  )
}
