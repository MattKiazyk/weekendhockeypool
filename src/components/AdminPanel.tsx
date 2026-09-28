import { useState } from 'react'
import type { Weekend } from '../lib/pool'
import { formatDay } from '../lib/format'

interface AdminPanelProps {
  week: Weekend
  saving: boolean
  onAction: (path: string, payload?: Record<string, unknown>) => Promise<void>
  onSelectWeek: (start: string) => void
}

export default function AdminPanel({ week, saving, onAction, onSelectWeek }: AdminPanelProps) {
  const [adminGameId, setAdminGameId] = useState('')
  const [adminAway, setAdminAway] = useState('')
  const [adminHome, setAdminHome] = useState('')
  const [adminState, setAdminState] = useState<'final' | 'void'>('final')
  const [newGameId, setNewGameId] = useState('')
  const [newStartUtc, setNewStartUtc] = useState('')
  const [newAwayCode, setNewAwayCode] = useState('')
  const [newAwayName, setNewAwayName] = useState('')
  const [newHomeCode, setNewHomeCode] = useState('')
  const [newHomeName, setNewHomeName] = useState('')

  return (
    <>
      <div className="admin-panel">
        <div className="results-intro">
          <span className="card-kicker">PRIVATE ADMIN CONTROLS</span>
          <h3>KEEP THE SLATE ACCURATE.</h3>
          <p>Resync before lock, correct a final score or void a game, then recalculate results.</p>
        </div>
        <div className="admin-actions">
          <button disabled={saving} onClick={() => void onAction('sync')}>
            Resync schedule
          </button>
          <button disabled={saving} onClick={() => void onAction('finalize')}>
            Recalculate final standings
          </button>
        </div>
        <div className="admin-form">
          <label>
            Game
            <select value={adminGameId} onChange={(event) => setAdminGameId(event.target.value)}>
              <option value="">Choose game</option>
              {week.games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.away.code} at {game.home.code} · {formatDay(game.easternDate)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Result
            <select
              value={adminState}
              onChange={(event) => setAdminState(event.target.value as 'final' | 'void')}
            >
              <option value="final">Final</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label>
            Away score
            <input
              type="number"
              min="0"
              value={adminAway}
              onChange={(event) => setAdminAway(event.target.value)}
              disabled={adminState === 'void'}
            />
          </label>
          <label>
            Home score
            <input
              type="number"
              min="0"
              value={adminHome}
              onChange={(event) => setAdminHome(event.target.value)}
              disabled={adminState === 'void'}
            />
          </label>
          <button
            disabled={!adminGameId || saving}
            onClick={() =>
              void onAction('game', {
                gameId: Number(adminGameId),
                state: adminState,
                awayScore: Number(adminAway),
                homeScore: Number(adminHome),
              })
            }
          >
            Save result
          </button>
        </div>
      </div>
      <div className="admin-panel admin-schedule">
        <div className="results-intro">
          <span className="card-kicker">SCHEDULE FALLBACK</span>
          <h3>MANUAL MATCHUP.</h3>
          <p>
            Add a missing NHL game before lock if the feed is unavailable. The game ID must match
            the NHL schedule.
          </p>
        </div>
        <div className="admin-form">
          <label>
            Weekend Friday
            <input
              type="date"
              value={week.startDate}
              onChange={(event) => onSelectWeek(event.target.value)}
            />
          </label>
          <label>
            NHL game ID
            <input
              type="number"
              value={newGameId}
              onChange={(event) => setNewGameId(event.target.value)}
            />
          </label>
          <label>
            Start, your local time
            <input
              type="datetime-local"
              value={newStartUtc}
              onChange={(event) => setNewStartUtc(event.target.value)}
            />
          </label>
          <label>
            Away code
            <input
              value={newAwayCode}
              onChange={(event) => setNewAwayCode(event.target.value)}
              placeholder="WPG"
            />
          </label>
          <label>
            Away name
            <input
              value={newAwayName}
              onChange={(event) => setNewAwayName(event.target.value)}
              placeholder="Winnipeg Jets"
            />
          </label>
          <label>
            Home code
            <input
              value={newHomeCode}
              onChange={(event) => setNewHomeCode(event.target.value)}
              placeholder="TOR"
            />
          </label>
          <label>
            Home name
            <input
              value={newHomeName}
              onChange={(event) => setNewHomeName(event.target.value)}
              placeholder="Toronto Maple Leafs"
            />
          </label>
          <button
            disabled={
              saving ||
              !newGameId ||
              !newStartUtc ||
              !newAwayCode ||
              !newAwayName ||
              !newHomeCode ||
              !newHomeName ||
              week.status !== 'open'
            }
            onClick={() =>
              void onAction('game', {
                gameId: Number(newGameId),
                startUtc: new Date(newStartUtc).toISOString(),
                awayCode: newAwayCode,
                awayName: newAwayName,
                homeCode: newHomeCode,
                homeName: newHomeName,
              })
            }
          >
            Add matchup
          </button>
          <button
            className="remove-button"
            disabled={saving || !adminGameId || week.status !== 'open'}
            onClick={() => void onAction('remove-game', { gameId: Number(adminGameId) })}
          >
            Remove selected game
          </button>
        </div>
      </div>
    </>
  )
}
