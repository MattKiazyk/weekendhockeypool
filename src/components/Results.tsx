import type {
  CombinedStanding,
  LeagueId,
  Weekend,
  WeekendStatus,
  Standing,
  PublicPick,
} from '../lib/pool'
import { CombinedStandingsList, StandingsList, EntrantsBoard } from './Standings'

interface WeekendResultsProps {
  week: Weekend
  demo: boolean
  displayStatus: WeekendStatus | 'upcoming'
  picksUnlocked: boolean
  signedIn: boolean
  standings: Standing[]
  entrants: string[]
  publicPicks: PublicPick[]
}
export function WeekendResults({
  week,
  demo,
  displayStatus,
  picksUnlocked,
  signedIn,
  standings,
  entrants,
  publicPicks,
}: WeekendResultsProps) {
  const games = week.games
  return (
    <div className="results-layout">
      <div className="results-main">
        <div className="results-intro">
          <span className="card-kicker">
            {displayStatus === 'final'
              ? demo
                ? 'SAMPLE RESULTS'
                : 'OFFICIAL RESULTS'
              : picksUnlocked
                ? 'PICKS REVEALED'
                : 'ENTRIES ARE ROLLING IN'}
          </span>
          <h3>
            {displayStatus === 'final'
              ? 'THE FINAL SCORE.'
              : picksUnlocked
                ? 'THE PICKS ARE IN.'
                : 'WHO’S ON THE BOARD?'}
          </h3>
          <p>
            {displayStatus === 'final'
              ? 'Every result is in. See how your confidence picks stacked up.'
              : picksUnlocked
                ? 'Open a player’s entry to see their picks. Rankings arrive when every game is final or void.'
                : 'Submitted usernames appear here right away. Picks stay hidden until the entry deadline passes, and rankings arrive after the final game.'}
          </p>
        </div>
        {displayStatus === 'final' && (
          <StandingsList rows={standings} emptyText="No completed entries for this week." />
        )}
        <EntrantsBoard
          usernames={entrants}
          games={games}
          picks={publicPicks}
          unlocked={picksUnlocked}
          canViewPicks={signedIn}
        />
      </div>
      <aside className="results-aside">
        <span className="card-kicker">WEEK SNAPSHOT</span>
        <strong>
          {games.filter((game) => game.state === 'final').length}
          <small>/{games.length}</small>
        </strong>
        <span>GAMES FINAL</span>
        <div className="board-divider" />
        <p>
          <b>{entrants.length}</b> {entrants.length === 1 ? 'player has' : 'players have'} submitted
          an entry.
        </p>
        <p>All game times and dates are shown in Eastern time.</p>
      </aside>
    </div>
  )
}
export function SeasonResults({
  season,
  league,
  scope,
  onScopeChange,
  demo,
  standings,
  combinedStandings,
}: {
  season: string
  league: LeagueId
  scope: 'league' | 'all'
  onScopeChange: (scope: 'league' | 'all') => void
  demo: boolean
  standings: Standing[]
  combinedStandings: CombinedStanding[]
}) {
  return (
    <div className="results-layout">
      <div className="results-main">
        <div className="results-intro">
          <span className="card-kicker">{demo ? 'SAMPLE' : season} REGULAR SEASON</span>
          <h3>EVERY WEEK COUNTS.</h3>
          <p>
            Points from finalized regular-season pools add up here. Enter one league or all three.
          </p>
          <div className="season-scope" aria-label="Season standings scope">
            <button
              className={scope === 'league' ? 'active' : ''}
              onClick={() => onScopeChange('league')}
            >
              {league.toUpperCase()}
            </button>
            <button
              className={scope === 'all' ? 'active' : ''}
              onClick={() => onScopeChange('all')}
            >
              All leagues
            </button>
          </div>
        </div>
        {scope === 'all' ? (
          <CombinedStandingsList rows={combinedStandings} />
        ) : (
          <StandingsList
            rows={standings}
            emptyText="The season table starts after the first completed week."
          />
        )}
      </div>
      <aside className="results-aside">
        <span className="card-kicker">THE RACE</span>
        <strong>{season}</strong>
        <span>{scope === 'all' ? 'ALL LEAGUES' : `${league.toUpperCase()} REGULAR SEASON`}</span>
        <div className="board-divider" />
        <p>
          Each league adds its finalized points right away. A dash means no finalized entry in that
          league. Tied totals share the same rank.
        </p>
      </aside>
    </div>
  )
}
