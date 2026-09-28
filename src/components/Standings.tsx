import type { CombinedStanding, Game, PublicPick, Standing } from '../lib/pool'

export function StandingsList({ rows, emptyText }: { rows: Standing[]; emptyText: string }) {
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
      {rows.map((row) => (
        <div className={`standing-row ${row.rank <= 3 ? 'top-rank' : ''}`} key={row.username}>
          <div>
            <span className="rank-number">{String(row.rank).padStart(2, '0')}</span>
            <strong>{row.username}</strong>
          </div>
          <span>{row.correct}</span>
          <b>{row.points}</b>
        </div>
      ))}
    </div>
  )
}

export function CombinedStandingsList({ rows }: { rows: CombinedStanding[] }) {
  if (!rows.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">▥</span>
        <h3>Nothing on the board yet</h3>
        <p>Combined totals start when the first league weekend is final.</p>
      </div>
    )
  return (
    <div className="standing-list combined-standing-list">
      <div className="standing-head">
        <span>RANK / PLAYER</span>
        <span>NHL</span>
        <span>PWHL</span>
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
  canViewPicks,
}: {
  usernames: string[]
  games: Game[]
  picks: PublicPick[]
  unlocked: boolean
  canViewPicks: boolean
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
          const userPicks = picks.filter((pick) => pick.username === username)
          const heading = (
            <>
              <span className="entrant-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{username}</strong>
              <span className="entrant-state">
                {!unlocked ? 'PICKS LOCKED' : canViewPicks ? 'VIEW PICKS ↘' : 'SIGN IN TO VIEW'}
              </span>
            </>
          )
          return unlocked && canViewPicks ? (
            <details className="entrant-row" key={`${username}-${index}`}>
              <summary>{heading}</summary>
              <div className="entrant-picks">
                {userPicks.length ? (
                  games.map((game) => {
                    const pick = userPicks.find((item) => item.game_id === game.id)
                    return pick ? (
                      <div className="entrant-pick" key={game.id}>
                        <span>
                          {game.away.name} at {game.home.name}
                        </span>
                        <b>{game[pick.side].name}</b>
                        <em>{pick.confidence}</em>
                      </div>
                    ) : null
                  })
                ) : (
                  <p>Picks are loading. Try opening this entry again shortly.</p>
                )}
              </div>
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
