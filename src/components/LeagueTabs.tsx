import { leagues } from '../lib/leagues'
import type { LeagueId } from '../lib/pool'

export default function LeagueTabs({
  league,
  onChange,
}: {
  league: LeagueId
  onChange: (league: LeagueId) => void
}) {
  return (
    <div className="league-tabs-wrap">
      <div className="league-tabs" aria-label="Choose league">
        {leagues.map((item) => (
          <button
            key={item.id}
            type="button"
            className={league === item.id ? 'active' : ''}
            aria-current={league === item.id ? 'page' : undefined}
            onClick={() => onChange(item.id)}
          >
            <img src={item.icon} alt="" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
