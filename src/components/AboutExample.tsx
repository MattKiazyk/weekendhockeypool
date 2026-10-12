import { useState } from 'react'
import { rankScores, scoreEntry, updatePick, type Game, type Pick } from '../lib/pool'
import Matchup from './Matchup'
import { StandingsList } from './Standings'

const games = (
  [
    {
      id: -1,
      sourceId: -1,
      startUtc: '2026-10-02T23:00:00Z',
      easternDate: '2026-10-02',
      away: { code: 'NYR', name: 'New York Rangers', logo: null },
      home: { code: 'DET', name: 'Detroit Red Wings', logo: null },
      state: 'scheduled',
      awayScore: null,
      homeScore: null,
      winner: null,
    },
    {
      id: -2,
      sourceId: -2,
      startUtc: '2026-10-03T00:00:00Z',
      easternDate: '2026-10-02',
      away: { code: 'WSH', name: 'Washington Capitals', logo: null },
      home: { code: 'CAR', name: 'Carolina Hurricanes', logo: null },
      state: 'scheduled',
      awayScore: null,
      homeScore: null,
      winner: null,
    },
  ] satisfies Game[]
).map((game) => ({
  ...game,
  away: { ...game.away, logo: `https://assets.nhle.com/logos/nhl/svg/${game.away.code}_light.svg` },
  home: { ...game.home, logo: `https://assets.nhle.com/logos/nhl/svg/${game.home.code}_light.svg` },
}))

const initialPicks: Pick[] = [
  { gameId: -1, side: 'away', confidence: 2 },
  { gameId: -2, side: 'away', confidence: 1 },
]
const winnerExampleGames = [{ ...games[0], id: -3 }]
const finalGames: Game[] = games.map((game, index) => ({
  ...game,
  state: 'final',
  awayScore: index === 0 ? 4 : 1,
  homeScore: index === 0 ? 2 : 3,
  winner: index === 0 ? 'away' : 'home',
}))
const entries = [
  { username: 'blue_line', picks: initialPicks },
  {
    username: 'hat_trick',
    picks: initialPicks.map((pick) => ({ ...pick, confidence: pick.confidence === 2 ? 1 : 2 })),
  },
]
const standings = rankScores(
  entries.map((entry) => ({ username: entry.username, ...scoreEntry(entry.picks, finalGames) })),
)
const publicPicks = entries.flatMap((entry) =>
  entry.picks.map((pick) => ({
    username: entry.username,
    game_id: pick.gameId,
    side: pick.side,
    confidence: pick.confidence,
  })),
)

export default function AboutExample({ step }: { step: string }) {
  const [picks, setPicks] = useState<Pick[]>(step === '02' ? initialPicks : [])

  return (
    <div className="about-demo" aria-label={`Step ${step} interactive example`}>
      <span className="about-demo-label">SAMPLE DATA · TRY IT HERE</span>
      {step === '03' ? (
        <>
          <StandingsList rows={standings} emptyText="" games={finalGames} picks={publicPicks} />
          <p className="about-demo-hint">
            Both players got one winner right. The higher confidence pick earned more points. Tap a
            player to see their picks and scores.
          </p>
        </>
      ) : (
        <>
          {(step === '01' ? winnerExampleGames : games).map((game) => (
            <Matchup
              key={game.id}
              game={game}
              pick={picks.find((pick) => pick.gameId === game.id)}
              allPicks={picks}
              count={games.length}
              editable
              onPick={(next) => setPicks((current) => updatePick(current, next))}
            />
          ))}
          <p className="about-demo-hint">
            {step === '01'
              ? 'Tap either team to choose your winner, then choose a confidence number.'
              : 'Tap a points number, then choose the number used on the other game to swap them. You can only use each number once.'}
          </p>
        </>
      )}
    </div>
  )
}
