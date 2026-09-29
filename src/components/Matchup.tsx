import { useState } from 'react'
import { confidenceNumbers, type Game, type Pick, type Side } from '../lib/pool'
import { formatTime } from '../lib/format'

function TeamButton({
  game,
  side,
  selected,
  disabled,
  onClick,
}: {
  game: Game
  side: Side
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  const team = game[side]
  return (
    <button
      type="button"
      className={`team-button ${side} ${selected ? 'selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Pick ${team.name} to win; season record ${team.record ?? 'unavailable'}`}
    >
      <span className="pick-indicator" aria-hidden="true">
        {selected ? '✓' : '+'}
      </span>
      {team.logo ? (
        <img src={team.logo} alt="" className="team-logo" loading="lazy" />
      ) : (
        <span className="team-fallback">{team.code}</span>
      )}
      <span className="team-copy">
        <strong>{team.name}</strong>
        <small className="team-role">
          {side.toUpperCase()}
          {game.state === 'final' ? ` · ${side === 'away' ? game.awayScore : game.homeScore}` : ''}
        </small>
        <small className="team-record">{team.record ?? 'Record unavailable'}</small>
      </span>
    </button>
  )
}

export default function Matchup({
  game,
  pick,
  allPicks,
  count,
  editable,
  onPick,
}: {
  game: Game
  pick?: Pick
  allPicks: Pick[]
  count: number
  editable: boolean
  onPick: (next: Pick) => void
}) {
  const [showNumbers, setShowNumbers] = useState(false)
  const usedElsewhere = new Set(
    allPicks.filter((item) => item.gameId !== game.id).map((item) => item.confidence),
  )
  const score =
    game.state === 'final'
      ? `${game.awayScore} – ${game.homeScore}`
      : game.state === 'void'
        ? 'VOID'
        : 'VS'
  const selectedConfidence = pick?.confidence || 0
  const confidenceId = `confidence-${game.id}`
  const unusedCount =
    count - new Set(allPicks.map((item) => item.confidence).filter((number) => number > 0)).size

  function chooseSide(side: Side) {
    onPick({ gameId: game.id, side, confidence: selectedConfidence })
    if (!selectedConfidence) setShowNumbers(true)
  }

  return (
    <article className={`matchup ${pick?.side ? 'has-pick' : ''}`}>
      <div className="matchup-top">
        <span className="game-time">{formatTime(game.startUtc)}</span>
        <span className={`game-state ${game.state}`}>
          {game.state === 'scheduled' ? 'UPCOMING' : game.state.toUpperCase()}
        </span>
      </div>
      <div className="matchup-grid">
        <TeamButton
          game={game}
          side="away"
          selected={pick?.side === 'away'}
          disabled={!editable}
          onClick={() => chooseSide('away')}
        />
        <div className="versus">
          <span>{score}</span>
          <button
            type="button"
            className={`confidence-trigger ${selectedConfidence ? 'assigned' : ''}`}
            disabled={!editable || !pick?.side}
            aria-label={`${selectedConfidence ? `Confidence ${selectedConfidence}` : 'Assign confidence'} for ${game.away.name} at ${game.home.name}`}
            aria-expanded={showNumbers && editable}
            aria-controls={confidenceId}
            onClick={() => setShowNumbers((open) => !open)}
          >
            <span className="confidence-value">{selectedConfidence || '+'}</span>
            <span className="confidence-trigger-copy">
              {selectedConfidence ? 'POINTS' : 'ASSIGN'}
            </span>
          </button>
        </div>
        <TeamButton
          game={game}
          side="home"
          selected={pick?.side === 'home'}
          disabled={!editable}
          onClick={() => chooseSide('home')}
        />
      </div>
      {showNumbers && editable && pick?.side && (
        <div
          className="confidence-panel"
          id={confidenceId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setShowNumbers(false)
          }}
        >
          <div className="confidence-panel-heading">
            <strong>Choose your confidence</strong>
            <span>{unusedCount} unused</span>
          </div>
          <div
            className="confidence-grid"
            role="group"
            aria-label={`Confidence numbers for ${game.away.name} at ${game.home.name}`}
          >
            {confidenceNumbers(count).map((number) => (
              <button
                type="button"
                key={number}
                disabled={usedElsewhere.has(number) && !selectedConfidence}
                aria-pressed={selectedConfidence === number}
                aria-label={`${number} confidence ${number === 1 ? 'point' : 'points'}${usedElsewhere.has(number) ? (selectedConfidence ? ', swap with another game' : ', used on another game') : ''}`}
                className={
                  selectedConfidence === number
                    ? 'selected'
                    : usedElsewhere.has(number)
                      ? 'occupied'
                      : ''
                }
                onClick={() => {
                  onPick({ gameId: game.id, side: pick.side, confidence: number })
                  setShowNumbers(false)
                }}
              >
                {number}
              </button>
            ))}
          </div>
          <p>
            {selectedConfidence
              ? 'Choosing a number on another game swaps the two.'
              : 'Higher numbers are worth more when your pick wins.'}
          </p>
        </div>
      )}
    </article>
  )
}
