import { describe, expect, it } from 'vitest'
import { easternDate, hasEntryDeadlinePassed, isEntryOpen, isInWeekend, lockTime, rankScores, scoreEntry, seasonFor, validatePicks, weekendStartAt, type Game, type Weekend } from '../src/lib/pool'

const games: Game[] = [
  { id: 1, startUtc: '2026-10-09T23:00:00Z', easternDate: '2026-10-09', away: { code: 'SEA', name: 'Seattle Kraken', logo: null }, home: { code: 'DET', name: 'Detroit Red Wings', logo: null }, state: 'final', awayScore: 3, homeScore: 2, winner: 'away' },
  { id: 2, startUtc: '2026-10-10T17:00:00Z', easternDate: '2026-10-10', away: { code: 'PHI', name: 'Philadelphia Flyers', logo: null }, home: { code: 'BOS', name: 'Boston Bruins', logo: null }, state: 'void', awayScore: null, homeScore: null, winner: null },
]

describe('pool rules', () => {
  it('uses Eastern dates even when UTC has moved to Monday', () => {
    expect(easternDate('2026-10-12T02:00:00Z')).toBe('2026-10-11')
    expect(isInWeekend('2026-10-11', '2026-10-09')).toBe(true)
    expect(isInWeekend('2026-10-12', '2026-10-09')).toBe(false)
    expect(weekendStartAt('2026-10-11T23:00:00Z')).toBe('2026-10-09')
    expect(weekendStartAt('2026-10-12T17:00:00Z')).toBe('2026-10-16')
  })

  it('locks at the earliest weekend game and identifies the NHL season', () => {
    expect(lockTime([...games].reverse())).toBe('2026-10-09T23:00:00Z')
    const weekend: Weekend = { startDate: '2026-10-09', season: '2026-27', lockAt: games[0].startUtc, status: 'open', finalizedAt: null, games }
    expect(isEntryOpen(weekend, Date.parse(games[0].startUtc) - 1)).toBe(true)
    expect(isEntryOpen(weekend, Date.parse(games[0].startUtc))).toBe(false)
    expect(hasEntryDeadlinePassed(weekend, Date.parse(games[0].startUtc) - 1)).toBe(false)
    expect(hasEntryDeadlinePassed(weekend, Date.parse(games[0].startUtc))).toBe(true)
    expect(hasEntryDeadlinePassed({ ...weekend, status: 'final' }, Date.parse(games[0].startUtc) - 1)).toBe(false)
    expect(hasEntryDeadlinePassed({ ...weekend, lockAt: null }, Date.parse(games[0].startUtc) + 1)).toBe(false)
    expect(seasonFor('2027-01-08')).toBe('2026-27')
  })

  it('requires one unique side and the complete confidence sequence', () => {
    expect(validatePicks([{ gameId: 1, side: 'away', confidence: 2 }, { gameId: 2, side: 'home', confidence: 1 }], games)).toEqual([])
    expect(validatePicks([{ gameId: 1, side: 'away', confidence: 2 }, { gameId: 2, side: 'home', confidence: 2 }], games)).not.toEqual([])
    expect(validatePicks([{ gameId: 1, side: 'away', confidence: 1 }], games)).not.toEqual([])
  })

  it('scores correct picks, gives void games zero, and shares tied ranks', () => {
    expect(scoreEntry([{ gameId: 1, side: 'away', confidence: 2 }, { gameId: 2, side: 'home', confidence: 1 }], games)).toEqual({ points: 2, correct: 1 })
    expect(rankScores([{ name: 'A', points: 8 }, { name: 'B', points: 8 }, { name: 'C', points: 4 }]).map((row) => row.rank)).toEqual([1, 1, 3])
  })
})
