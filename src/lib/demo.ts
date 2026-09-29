import schedule from '../demo-schedule.json'
import nflSchedule from '../demo-nfl-schedule.json'
import { emptyPool, type PoolData } from './api'
import {
  addDays,
  entryOpensAt,
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
const demoNflWeek = nflSchedule as Weekend
const demoStarts = [-14, -7, 0, 7, 14].map((days) => addDays(demoWeek.startDate, days))
const storageKey = 'hockey-pool-demo-entry'
const nflStorageKey = 'hockey-pool-demo-entry-nfl'
const players = ['blue_line', 'north_end', 'hat_trick']

export type DemoStage = WeekendStatus | 'upcoming' | 'offseason'

function demoWeekFor(startDate: string): Weekend {
  const days = Math.round(
    (Date.parse(`${startDate}T12:00:00Z`) - Date.parse(`${demoWeek.startDate}T12:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  )
  return {
    ...demoWeek,
    league: 'nhl',
    startDate,
    weekNumber: null,
    opensAt: entryOpensAt(startDate),
    lockAt: demoWeek.lockAt
      ? new Date(Date.parse(demoWeek.lockAt) + days * 24 * 60 * 60 * 1000).toISOString()
      : null,
    games: demoWeek.games.map((game) => ({
      ...game,
      id: game.id + days * 10000,
      startUtc: new Date(Date.parse(game.startUtc) + days * 24 * 60 * 60 * 1000).toISOString(),
      easternDate: addDays(game.easternDate, days),
    })),
  }
}

function selectedDemoWeek(league: LeagueId, startDate?: string | null): Weekend {
  if (league === 'nfl') return demoNflWeek
  const selected = startDate && demoStarts.includes(startDate) ? startDate : demoWeek.startDate
  return demoWeekFor(selected)
}

function demoStorageKey(league: LeagueId, startDate?: string | null): string {
  if (league === 'nfl') return nflStorageKey
  const selected = selectedDemoWeek(league, startDate).startDate
  return selected === demoWeek.startDate ? storageKey : `${storageKey}-${selected}`
}

export function readDemoEntry(league: LeagueId, startDate?: string | null): Entry | null {
  try {
    const saved = localStorage.getItem(demoStorageKey(league, startDate))
    if (!saved) return null
    const entry = JSON.parse(saved) as Entry
    if (
      !entry ||
      !Array.isArray(entry.picks) ||
      typeof entry.submittedAt !== 'string' ||
      typeof entry.updatedAt !== 'string'
    )
      return null
    if (validatePicks(entry.picks, selectedDemoWeek(league, startDate).games).length) return null
    return entry
  } catch {
    // Ignore unavailable storage and stale or malformed preview entries.
    return null
  }
}

export function saveDemoEntry(entry: Entry, league: LeagueId, startDate?: string | null): void {
  localStorage.setItem(demoStorageKey(league, startDate), JSON.stringify(entry))
}

export function getDemoData(
  league: LeagueId,
  stage: DemoStage,
  entry: Entry | null,
  username: string | null,
  selectedWeek: string | null,
): PoolData {
  const seasonStandings = rankScores([
    { username: 'blue_line', points: 684, correct: 61 },
    { username: 'north_end', points: 648, correct: 58 },
    { username: username ?? 'rinkside_77', points: 612, correct: 56 },
    { username: 'hat_trick', points: 571, correct: 50 },
  ])
  const combinedStandings = seasonStandings.map((row) => ({
    ...row,
    nhlPoints: league === 'nhl' ? row.points : null,
    pwhlPoints: null,
    nflPoints: league === 'nfl' ? row.points : null,
  }))
  if (league === 'pwhl') return { ...emptyPool, combinedStandings }

  const nflHistory = [
    {
      league: 'nfl' as const,
      start_date: demoNflWeek.startDate,
      season: demoNflWeek.season,
      week_number: demoNflWeek.weekNumber,
      status: 'final' as const,
    },
  ]
  if (league === 'nfl' && stage === 'offseason' && !selectedWeek)
    return { ...emptyPool, nflOffseason: true, weeks: nflHistory, combinedStandings }

  const sample = selectedDemoWeek(league, selectedWeek)
  const currentEntry = entry && !validatePicks(entry.picks, sample.games).length ? entry : null
  const shownStage = stage === 'offseason' ? 'final' : stage
  const games =
    shownStage === 'final'
      ? sample.games.map((game, index) => ({
          ...game,
          state: 'final' as const,
          awayScore: index % 3 === 0 ? 4 : 2,
          homeScore: index % 3 === 0 ? 2 : 4,
          winner: index % 3 === 0 ? ('away' as const) : ('home' as const),
        }))
      : sample.games
  const publicPicks: PublicPick[] = []
  if (shownStage === 'locked' || shownStage === 'final') {
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
    if (currentEntry && username) {
      publicPicks.push(
        ...currentEntry.picks.map((pick) => ({
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
    week: { ...sample, status: shownStage === 'upcoming' ? 'open' : shownStage, games },
    weeks:
      league === 'nfl'
        ? nflHistory
        : demoStarts.map((start_date) => ({
            league,
            start_date,
            season: sample.season,
            week_number: null,
            status: 'open' as const,
          })),
    entry: currentEntry,
    publicPicks,
    entrants: [...new Set([...players, ...(currentEntry && username ? [username] : [])])].sort(
      (a, b) => a.localeCompare(b),
    ),
    standings:
      shownStage === 'final'
        ? rankScores([
            { username: 'blue_line', points: 146, correct: 13 },
            { username: 'north_end', points: 131, correct: 12 },
            ...(currentEntry && username
              ? [{ username, ...scoreEntry(currentEntry.picks, games) }]
              : []),
            { username: 'hat_trick', points: 97, correct: 9 },
          ])
        : [],
    seasonStandings,
    combinedStandings,
  }
}
