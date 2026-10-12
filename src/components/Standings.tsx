import { formatTime } from '../lib/format'
import type { CombinedStanding, Game, PublicPick, Standing } from '../lib/pool'

export function StandingsList({
  rows,
  emptyText,
  games,
  picks,
}: {
  rows: Standing[]
  emptyText: string
  games?: Game[]
  picks?: PublicPick[]
}) {
  if (!rows.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">▥</span>
        <h3>Nothing on the board yet</h3>
        <p>{emptyText}</p>
      </div>
    )
  return (
    <div className="standing-list">
      <div className="standing-head">
        <span>RANK / PLAYER</span>
        <span>CORRECT</span>
        <span>POINTS</span>
      </div>
      {rows.map((row) => {
        const heading = (
          <>
            <div>
              <span className="rank-number">{String(row.rank).padStart(2, '0')}</span>
              <strong>{row.username}</strong>
            </div>
            <span>{row.correct}</span>
            <b>{row.points}</b>
          </>
        )
        const className = `standing-row ${row.rank <= 3 ? 'top-rank' : ''}`
        return games && picks ? (
          <details className="standing-entry" key={row.username}>
            <summary className={className} aria-label={`View ${row.username}’s picks`}>
              {heading}
            </summary>
            <EntryPicks games={games} picks={picks} username={row.username} />
          </details>
        ) : (
          <div className={className} key={row.username}>
            {heading}
          </div>
        )
      })}
    </div>
  )
}

export function CombinedStandingsList({ rows }: { rows: CombinedStanding[] }) {
  if (!rows.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">▥</span>
        <h3>Nothing on the board yet</h3>
        <p>Combined totals start when the first league week is final.</p>
      </div>
    )
  return (
    <div className="standing-list combined-standing-list">
      <div className="standing-head">
        <span>RANK / PLAYER</span>
        <span>NHL</span>
        <span>PWHL</span>
        <span>NFL</span>
        <span>CFL</span>
        <span>TOTAL</span>
      </div>
      {rows.map((row) => (
        <div className={`standing-row ${row.rank <= 3 ? 'top-rank' : ''}`} key={row.username}>
          <div>
            <span className="rank-number">{String(row.rank).padStart(2, '0')}</span>
            <strong>{row.username}</strong>
          </div>
          <span>{row.nhlPoints ?? '—'}</span>
          <span>{row.pwhlPoints ?? '—'}</span>
          <span>{row.nflPoints ?? '—'}</span>
          <span>{row.cflPoints ?? '—'}</span>
          <b>{row.points}</b>
        </div>
      ))}
    </div>
  )
}

export function EntrantsBoard({
  usernames,
  games,
  picks,
  unlocked,
}: {
  usernames: string[]
  games: Game[]
  picks: PublicPick[]
  unlocked: boolean
}) {
  return (
    <section className="entrants-board" aria-label="Submitted entries">
      <div className="entrants-heading">
        <div>
          <span className="card-kicker">ON THE BOARD</span>
          <h4>ENTRIES IN</h4>
        </div>
        <span>
          {usernames.length} {usernames.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>
      {!usernames.length ? (
        <div className="entrant-empty">
          No entries submitted yet. Names appear here as soon as players save a complete pick sheet.
        </div>
      ) : (
        usernames.map((username, index) => {
          const heading = (
            <>
              <span className="entrant-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{username}</strong>
              <span className="entrant-state">{!unlocked ? 'PICKS LOCKED' : 'VIEW PICKS ↘'}</span>
            </>
          )
          return unlocked ? (
            <details className="entrant-row" key={`${username}-${index}`}>
              <summary>{heading}</summary>
              <EntryPicks games={games} picks={picks} username={username} />
            </details>
          ) : (
            <div className="entrant-row closed" key={`${username}-${index}`}>
              {heading}
            </div>
          )
        })
      )}
      {!unlocked && !!usernames.length && (
        <p className="entrants-note">
          Usernames are visible now. Picks open after the entry deadline.
        </p>
      )}
    </section>
  )
}

function EntryPicks({
  games,
  picks,
  username,
}: {
  games: Game[]
  picks: PublicPick[]
  username: string
}) {
  const userPicks = picks.filter((pick) => pick.username === username)
  return (
    <div className="entrant-picks">
      {userPicks.length ? (
        games.map((game) => {
          const pick = userPicks.find((item) => item.game_id === game.id)
          const incorrect = game.state === 'final' && !!game.winner && game.winner !== pick?.side
          const result =
            game.state === 'void'
              ? 'Void'
              : game.state === 'final'
                ? incorrect
                  ? 'Incorrect'
                  : game.winner
                    ? 'Correct'
                    : 'Void'
                : 'Pending'
          return pick ? (
            <div
              className={`entrant-pick ${result === 'Correct' ? 'correct' : incorrect ? 'incorrect' : ''}`}
              key={game.id}
              aria-label={`${game.away.name} at ${game.home.name}; picked ${game[pick.side].name}, confidence ${pick.confidence}; ${result}`}
            >
              <div className={`entry-team away ${pick.side === 'away' ? 'selected' : ''}`}>
                {game.away.logo ? (
                  <img src={game.away.logo} alt="" loading="lazy" />
                ) : (
                  <span className="entry-logo-fallback">{game.away.code}</span>
                )}
                <span>{game.away.code}</span>
                {pick.side === 'away' && (
                  <em aria-label={`Confidence ${pick.confidence}`}>{pick.confidence}</em>
                )}
              </div>
              <span className="entry-score">
                {game.state === 'void'
                  ? 'VOID'
                  : game.awayScore !== null && game.homeScore !== null
                    ? `${game.awayScore}–${game.homeScore}`
                    : 'VS'}
                {game.state === 'live' && <small>LIVE</small>}
                {game.state === 'scheduled' && <small>{formatTime(game.startUtc)}</small>}
              </span>
              <div className={`entry-team home ${pick.side === 'home' ? 'selected' : ''}`}>
                {pick.side === 'home' && (
                  <em aria-label={`Confidence ${pick.confidence}`}>{pick.confidence}</em>
                )}
                <span>{game.home.code}</span>
                {game.home.logo ? (
                  <img src={game.home.logo} alt="" loading="lazy" />
                ) : (
                  <span className="entry-logo-fallback">{game.home.code}</span>
                )}
              </div>
            </div>
          ) : null
        })
      ) : (
        <p>Picks are loading. Try opening this entry again shortly.</p>
      )}
    </div>
  )
}
