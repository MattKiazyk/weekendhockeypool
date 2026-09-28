import schedule from '../demo-schedule.json'
import { emptyPool, type PoolData } from './api'
import {
  rankScores,
  scoreEntry,
  validatePicks,
  type Entry,
  type LeagueId,
  type PublicPick,
  type Weekend,
  type WeekendStatus,
} from './pool'

const demoWeek = schedule as Weekend
const storageKey = 'hockey-pool-demo-entry'
const players = ['blue_line', 'north_end', 'hat_trick']

export function readDemoEntry(): Entry | null {
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return null
    const entry = JSON.parse(saved) as Entry
    if (
      !entry ||
      !Array.isArray(entry.picks) ||
      typeof entry.submittedAt !== 'string' ||
      typeof entry.updatedAt !== 'string'
    )
      return null
    if (validatePicks(entry.picks, demoWeek.games).length) return null
    return entry
  } catch {
    // Ignore unavailable storage and stale or malformed preview entries.
    return null
  }
}

export function saveDemoEntry(entry: Entry): void {
  localStorage.setItem(storageKey, JSON.stringify(entry))
}

export function getDemoData(
  league: LeagueId,
  stage: WeekendStatus,
  entry: Entry | null,
  username: string | null,
): PoolData {
  const seasonStandings = rankScores([
    { username: 'blue_line', points: 684, correct: 61 },
    { username: 'north_end', points: 648, correct: 58 },
    { username: username ?? 'rinkside_77', points: 612, correct: 56 },
    { username: 'hat_trick', points: 571, correct: 50 },
  ])
  const combinedStandings = seasonStandings.map((row) => ({
    ...row,
    nhlPoints: row.points,
    pwhlPoints: null,
  }))
  if (league === 'pwhl') return { ...emptyPool, combinedStandings }
  const games =
    stage === 'final'
      ? demoWeek.games.map((game, index) => ({
          ...game,
          state: 'final' as const,
          awayScore: index % 3 === 0 ? 4 : 2,
          homeScore: index % 3 === 0 ? 2 : 4,
          winner: index % 3 === 0 ? ('away' as const) : ('home' as const),
        }))
      : demoWeek.games
  const publicPicks: PublicPick[] = []
  if (stage !== 'open') {
    players.forEach((name, playerIndex) => {
      games.forEach((game, index) =>
        publicPicks.push({
          username: name,
          game_id: game.id,
          side: (index + playerIndex) % 2 ? 'home' : 'away',
          confidence: ((index + playerIndex * 4) % games.length) + 1,
        }),
      )
    })
    if (entry && username) {
      publicPicks.push(
        ...entry.picks.map((pick) => ({
          username,
          game_id: pick.gameId,
          side: pick.side,
          confidence: pick.confidence,
        })),
      )
    }
  }
  return {
    ...emptyPool,
    week: { ...demoWeek, status: stage, games },
    entry,
    publicPicks,
    entrants: [...new Set([...players, ...(entry && username ? [username] : [])])].sort((a, b) =>
      a.localeCompare(b),
    ),
    standings:
      stage === 'final'
        ? rankScores([
            { username: 'blue_line', points: 146, correct: 13 },
            { username: 'north_end', points: 131, correct: 12 },
            ...(entry && username ? [{ username, ...scoreEntry(entry.picks, games) }] : []),
            { username: 'hat_trick', points: 97, correct: 9 },
          ])
        : [],
    seasonStandings,
    combinedStandings,
  }
}
