import { leagues } from '../lib/leagues'
import type { LeagueId } from '../lib/pool'

export default function LeagueTabs({
  league,
  onChange,
  openLeagues,
}: {
  league: LeagueId
  onChange: (league: LeagueId) => void
  openLeagues: LeagueId[]
}) {
  return (
    <div className="league-tabs-wrap">
      <div className="league-tabs" aria-label="Choose league">
        {leagues.map((item) => (
          <button
            key={item.id}
            type="button"
            data-league={item.id}
            className={league === item.id ? 'active' : ''}
            aria-current={league === item.id ? 'page' : undefined}
            aria-label={openLeagues.includes(item.id) ? `${item.label}, picks open` : item.label}
            onClick={() => onChange(item.id)}
          >
            <img src={item.icon} alt="" aria-hidden="true" />
            <span className="league-tab-label">
              <span>{item.label}</span>
              {openLeagues.includes(item.id) && (
                <span className="league-tab-status" aria-hidden="true">
                  <i /> OPEN
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
