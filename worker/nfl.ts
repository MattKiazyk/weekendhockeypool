import {
  addDays,
  easternDate,
  easternTimeAt,
  seasonFor,
  type Game,
  type Weekend,
} from '../src/lib/pool'
import type { GameResult, WeekSchedule } from './feeds'

interface NflTeam {
  abbreviation?: string
  displayName?: string
  logo?: string
}

interface NflCompetitor {
  homeAway: 'home' | 'away'
  score?: string | number | null
  team: NflTeam
}

export interface NflEvent {
  id: string
  date: string
  season?: { year: number; type: number }
  week?: { number: number }
  status: { type: { name: string; state: string; completed: boolean } }
  competitions: { competitors: NflCompetitor[] }[]
}

interface NflCalendarEntry {
  label: string
  value: string
  startDate: string
  endDate: string
}

interface NflScoreboard {
  leagues?: { calendar?: { value: string; entries?: NflCalendarEntry[] }[] }[]
  events?: NflEvent[]
}

export interface NflWeek {
  seasonYear: number
  number: number
  startDate: string
  opensAt: string
  closesAt: string
  feedStartsAt: string
  feedEndsAt: string
}

async function nfl(path: string): Promise<unknown> {
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/${path}`,
    {
      // ESPN's Akamai edge rejects the default Worker user agent.
      headers: { accept: 'application/json', 'user-agent': 'curl/8.7.1' },
      signal: AbortSignal.timeout(12000),
    },
  )
  if (!response.ok) throw new Error(`NFL feed returned ${response.status}`)
  return response.json()
}

async function scoreboard(year: number, week: number): Promise<NflScoreboard> {
  const body = (await nfl(`scoreboard?dates=${year}&seasontype=2&week=${week}`)) as NflScoreboard
  if (!body || typeof body !== 'object' || !Array.isArray(body.events))
    throw new Error('NFL scoreboard response is invalid')
  return body
}

export function weekFromNflCalendar(entry: NflCalendarEntry, seasonYear: number): NflWeek {
  const number = Number(entry.value)
  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 25 ||
    !Number.isFinite(Date.parse(entry.startDate)) ||
    !Number.isFinite(Date.parse(entry.endDate))
  )
    throw new Error('NFL week calendar is invalid')
  const end = easternDate(entry.endDate)
  if (new Date(`${end}T12:00:00Z`).getUTCDay() !== 3)
    throw new Error('NFL week must end on Wednesday in Eastern time')
  const startDate = addDays(end, -6)
  return {
    seasonYear,
    number,
    startDate,
    opensAt: easternTimeAt(addDays(startDate, -2), 8),
    closesAt: easternTimeAt(addDays(startDate, 5), 8),
    feedStartsAt: entry.startDate,
    feedEndsAt: entry.endDate,
  }
}

export async function nflWeeks(seasonYear: number): Promise<NflWeek[]> {
  const body = await scoreboard(seasonYear, 1)
  const regular = body.leagues
    ?.flatMap((league) => league.calendar ?? [])
    .find((item) => item.value === '2')
  if (!regular) return []
  if (!Array.isArray(regular.entries)) throw new Error('NFL regular-season calendar is invalid')
  return regular.entries.map((entry) => weekFromNflCalendar(entry, seasonYear))
}

export async function currentNflWeek(now = Date.now()): Promise<NflWeek | null> {
  return (await nflWeekContext(now)).active
}

export async function nflWeekContext(now = Date.now()): Promise<{
  active: NflWeek | null
  next: NflWeek | null
  offseason: boolean
}> {
  const year = Number(seasonFor(easternDate(now)).slice(0, 4))
  const weeks = await nflWeeks(year)
  const active =
    weeks.find((week) => now >= Date.parse(week.opensAt) && now < Date.parse(week.closesAt)) ?? null
  const next = weeks.find((week) => now < Date.parse(week.opensAt)) ?? null
  return {
    active,
    next,
    offseason:
      !active &&
      (!weeks.length ||
        now < Date.parse(weeks[0].opensAt) ||
        now >= Date.parse(weeks[weeks.length - 1].closesAt)),
  }
}

export async function nflWeekByStart(start: string): Promise<NflWeek | null> {
  const year = Number(seasonFor(start).slice(0, 4))
  return (await nflWeeks(year)).find((week) => week.startDate === start) ?? null
}

function sourceId(raw: NflEvent): number {
  const id = Number(raw.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('NFL game ID is invalid')
  return id
}

function competitors(raw: NflEvent): { away: NflCompetitor; home: NflCompetitor } {
  const members = raw.competitions?.[0]?.competitors
  const away = members?.find((item) => item.homeAway === 'away')
  const home = members?.find((item) => item.homeAway === 'home')
  if (!away?.team.abbreviation || !home?.team.abbreviation) {
    throw new Error('NFL competitor data is invalid')
  }
  return { away, home }
}

export function gameFromNfl(raw: NflEvent): Game {
  const id = sourceId(raw)
  const date = new Date(raw.date)
  if (!Number.isFinite(date.getTime())) throw new Error('NFL game time is invalid')
  const { away, home } = competitors(raw)
  return {
    id,
    sourceId: id,
    startUtc: date.toISOString(),
    easternDate: easternDate(date),
    away: {
      code: away.team.abbreviation!,
      name: away.team.displayName ?? away.team.abbreviation!,
      logo: away.team.logo ?? null,
    },
    home: {
      code: home.team.abbreviation!,
      name: home.team.displayName ?? home.team.abbreviation!,
      logo: home.team.logo ?? null,
    },
    state: 'scheduled',
    awayScore: null,
    homeScore: null,
    winner: null,
  }
}

export async function getNflSchedule(start: string): Promise<WeekSchedule> {
  const seasonYear = Number(seasonFor(start).slice(0, 4))
  const week = await nflWeekByStart(start)
  if (!week) throw new Error('NFL regular-season week is unavailable')
  const body = await scoreboard(seasonYear, week.number)
  const games = body.events!.filter(
    (event) =>
      event.season?.year === seasonYear &&
      event.season.type === 2 &&
      event.week?.number === week.number,
  )
  return {
    games: games.map(gameFromNfl),
    season: seasonFor(start),
    weekNumber: week.number,
    opensAt: week.opensAt,
  }
}

function score(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

export function resultFromNfl(raw: NflEvent, expectedWeek: number): GameResult {
  const status = raw.status?.type
  if (!status) throw new Error('NFL game status is invalid')
  if (raw.week?.number !== expectedWeek || /POSTPON|CANCEL|SUSPEND/i.test(status.name))
    return { state: 'void', awayScore: null, homeScore: null, winner: null }
  const { away, home } = competitors(raw)
  const awayScore = score(away.score)
  const homeScore = score(home.score)
  if (status.completed) {
    if (awayScore === null || homeScore === null) throw new Error('NFL final score is invalid')
    if (awayScore === homeScore)
      return { state: 'void', awayScore: null, homeScore: null, winner: null }
    return {
      state: 'final',
      awayScore,
      homeScore,
      winner: awayScore > homeScore ? 'away' : 'home',
    }
  }
  return {
    state: status.state === 'in' ? 'live' : 'scheduled',
    awayScore: status.state === 'in' ? awayScore : null,
    homeScore: status.state === 'in' ? homeScore : null,
    winner: null,
  }
}

async function eventSummary(id: number): Promise<NflEvent> {
  const body = (await nfl(`summary?event=${id}`)) as {
    header?: {
      week?: number
      season?: { year: number; type: number }
      competitions?: { date: string; status: NflEvent['status']; competitors: NflCompetitor[] }[]
    }
  }
  const competition = body.header?.competitions?.[0]
  if (!competition || !body.header?.week) throw new Error('NFL game summary is invalid')
  return {
    id: String(id),
    date: competition.date,
    season: body.header.season,
    week: { number: body.header.week },
    status: competition.status,
    competitions: [competition],
  }
}

export async function getNflResults(week: Weekend): Promise<Map<number, GameResult>> {
  if (!week.weekNumber) throw new Error('NFL week number is missing')
  const year = Number(week.season.slice(0, 4))
  const body = await scoreboard(year, week.weekNumber)
  const byId = new Map(body.events!.map((event) => [sourceId(event), event]))
  const results = new Map<number, GameResult>()
  for (const game of week.games) {
    let raw = byId.get(game.sourceId)
    if (!raw) {
      try {
        raw = await eventSummary(game.sourceId)
      } catch {
        // A missing event is retried on the next result sync.
      }
    }
    if (raw) results.set(game.sourceId, resultFromNfl(raw, week.weekNumber))
  }
  return results
}
