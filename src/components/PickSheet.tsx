import { useState } from 'react'
import {
  addDays,
  confidenceNumbers,
  validatePicks,
  type Entry,
  type Pick,
  type PublicPick,
  type Weekend,
} from '../lib/pool'
import type { PoolSession } from '../lib/session'
import type { SaveFeedback } from './SaveToast'
import { formatDay } from '../lib/format'
import Matchup from './Matchup'
import { EntrantsBoard } from './Standings'

interface PickSheetProps {
  week: Weekend
  session: PoolSession
  draft: Pick[]
  entry: Entry | null
  open: boolean
  upcoming: boolean
  picksUnlocked: boolean
  entrants: string[]
  publicPicks: PublicPick[]
  saving: boolean
  saveFeedback: SaveFeedback | null
  onPick: (pick: Pick) => void
  onSave: () => Promise<void>
  onMessage: (message: string) => void
  onError: (error: string) => void
}

export default function PickSheet({
  week,
  session,
  draft,
  entry,
  open,
  upcoming,
  picksUnlocked,
  entrants,
  publicPicks,
  saving,
  saveFeedback,
  onPick,
  onSave,
  onMessage,
  onError,
}: PickSheetProps) {
  const [alias, setAlias] = useState('')
  const games = week.games
  const pickedCount = draft.filter((pick) => pick.confidence > 0).length
  const errors = validatePicks(draft, games)
  const numbers = confidenceNumbers(games.length)
  const used = new Set(draft.map((pick) => pick.confidence))
  const remaining = numbers.filter((number) => !used.has(number))
  async function changeAlias() {
    try {
      await session.setUsername(alias.trim())
      setAlias('')
      onMessage('Your public username is set.')
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not set username')
    }
  }
  return (
    <div className="pick-layout">
      <div className="games-column">
        {upcoming && (
          <div className="inline-callout upcoming-callout">
            <div>
              <b>Matchups are ready.</b>
              <span>
                Picks open Monday at 8:00 a.m. Eastern. Come back then to choose your teams.
              </span>
            </div>
          </div>
        )}
        {!session.signedIn && open && (
          <div className="inline-callout">
            <div>
              <b>Get in on the action.</b>
              <span>Sign in to make your picks for this weekend.</span>
            </div>
            <button onClick={session.signIn}>Sign in to play →</button>
          </div>
        )}
        {session.signedIn && !session.username && open && (
          <div className="inline-callout">
            <div>
              <b>Choose your public username.</b>
              <span>Only this name appears on pool results.</span>
            </div>
            <div className="alias-form">
              <input
                aria-label="Public username"
                placeholder="Your username"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
              />
              <button disabled={alias.trim().length < 4} onClick={() => void changeAlias()}>
                Save
              </button>
            </div>
          </div>
        )}
        {[0, 1, 2].map((offset) => {
          const date = addDays(week.startDate, offset)
          const dayGames = games.filter((game) => game.easternDate === date)
          const [dayName, ...dayDate] = formatDay(date).toUpperCase().split(',')
          return (
            <section className="day-section" key={date}>
              <div className="day-heading">
                <div>
                  <span className="day-index">0{offset + 1}</span>
                  <h3>{dayName}</h3>
                  <span className="day-date">{dayDate.join(',').trim()}</span>
                </div>
                <span className="day-count">
                  {dayGames.length} {dayGames.length === 1 ? 'GAME' : 'GAMES'}
                </span>
              </div>
              {dayGames.length ? (
                dayGames.map((game) => (
                  <Matchup
                    key={game.id}
                    game={game}
                    pick={draft.find((pick) => pick.gameId === game.id)}
                    allPicks={draft}
                    count={games.length}
                    editable={session.signedIn && !!session.username && open}
                    onPick={onPick}
                  />
                ))
              ) : (
                <div className="no-games">No games scheduled.</div>
              )}
            </section>
          )
        })}
        {picksUnlocked && session.signedIn && (
          <div className="other-picks">
            <EntrantsBoard
              usernames={entrants}
              games={games}
              picks={publicPicks}
              unlocked
              canViewPicks
            />
          </div>
        )}
      </div>
      <aside className="sidebar">
        <div className="board-card">
          <span className="card-kicker">YOUR ENTRY</span>
          <div className="board-score">
            <strong>
              {pickedCount}
              <span>/{games.length}</span>
            </strong>
            <small>GAMES RANKED</small>
          </div>
          <div className="progress-track">
            <span style={{ width: `${games.length ? (pickedCount / games.length) * 100 : 0}%` }} />
          </div>
          <div className="board-divider" />
          <div className="board-label">
            <b>AVAILABLE NUMBERS</b>
            <small>{remaining.length} LEFT</small>
          </div>
          <div className="number-grid">
            {numbers.map((number) => (
              <span key={number} className={remaining.includes(number) ? '' : 'used'}>
                {number}
              </span>
            ))}
          </div>
          {open ? (
            <>
              <button
                className="save-button"
                disabled={!session.signedIn || !session.username || !!errors.length || saving}
                onClick={() => void onSave()}
              >
                {saving ? 'Saving…' : entry ? 'Update my picks' : 'Submit my picks'} <span>→</span>
              </button>
              {saveFeedback && (
                <div className={`save-inline ${saveFeedback.kind}`}>
                  <b>{saveFeedback.kind === 'success' ? '✓ SAVED' : 'SAVE FAILED'}</b>
                  <span>{saveFeedback.text}</span>
                </div>
              )}
              {errors.length ? (
                <p className="board-help">{errors[0]}</p>
              ) : (
                !saveFeedback && (
                  <p className="board-help">All picks are ready. You can revise them until lock.</p>
                )
              )}
            </>
          ) : upcoming ? (
            <div className="locked-note upcoming-note">
              {entry
                ? 'Your saved entry is on file. You can change it when picks open Monday at 8:00 a.m. Eastern.'
                : 'Team picks and submission open Monday at 8:00 a.m. Eastern.'}
            </div>
          ) : (
            <div className="locked-note">
              {entry ? 'Your entry is locked in.' : 'Entries are closed.'}
            </div>
          )}
        </div>
        <div className="rules-card">
          <span className="card-kicker">HOW SCORING WORKS</span>
          <p>
            <b>{games.length}</b> on a winner? Earn <b>{games.length} points.</b>
            <br />
            Miss the pick? Earn <b>0.</b>
          </p>
          <small>Each number can be used once. Highest weekend total takes the top spot.</small>
        </div>
      </aside>
    </div>
  )
}
