import { addDays, easternDate, easternTimeAt, type Game, type Weekend } from '../src/lib/pool'
import type { GameResult, WeekSchedule } from './feeds'

const base = 'https://echo.pims.cfl.ca/api'
const pageSize = 100
const maxPages = 20

export interface CflFixture {
  ID: number
  season_id: number
  week: number
  game_type_id: number
  start_at: string
  home_team_id: number | null
  away_team_id: number | null
  game_status?: string
  home_team_score?: number | null
  away_team_score?: number | null
}
interface CflTeam {
  ID: number
  name: string
  region_label: string
  abbreviation: string
  logo_svg?: string
}
export interface CflWeek {
  seasonYear: number
  number: number
  startDate: string
  opensAt: string
  closesAt: string
}

export function cflSeason(year: number): string {
  return `${year}-${String(year + 1).slice(-2)}`
}
async function cfl(path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`CFL feed returned ${response.status}`)
  return response.json()
}
function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function fixture(value: unknown): CflFixture {
  if (!value || typeof value !== 'object') throw new Error('CFL fixture is invalid')
  const raw = value as CflFixture
  if (
    !positiveId(raw.ID) ||
    !positiveId(raw.season_id) ||
    !positiveId(raw.week) ||
    !Number.isInteger(raw.game_type_id) ||
    typeof raw.start_at !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(raw.start_at) ||
    !Number.isFinite(Date.parse(raw.start_at))
  )
    throw new Error('CFL fixture is invalid')
  return raw
}
async function seasonId(year: number): Promise<number | null> {
  const body = await cfl('/seasons')
  if (
    !Array.isArray(body) ||
    !body.length ||
    body.some((item) => !positiveId(item?.ID) || !Number.isInteger(item?.year))
  )
    throw new Error('CFL seasons are invalid')
  const matches = body.filter((item) => item?.year === year)
  if (!matches.length) return null
  if (matches.length !== 1 || !positiveId(matches[0].ID)) throw new Error('CFL season is invalid')
  return matches[0].ID
}
export async function cflFixtures(id: number): Promise<CflFixture[]> {
  const games: CflFixture[] = []
  const allIds = new Set<number>()
  for (let page = 1; page <= maxPages; page++) {
    const body = await cfl(`/seasons/${id}/fixtures?limit=${pageSize}&page=${page}`)
    if (!Array.isArray(body) || body.length > pageSize) throw new Error('CFL fixtures are invalid')
    for (const value of body) {
      // Playoff placeholders can have no kickoff yet; they are not pool games.
      if (
        !value ||
        typeof value !== 'object' ||
        !positiveId(value.ID) ||
        value.season_id !== id ||
        !Number.isInteger(value.game_type_id)
      )
        throw new Error('CFL fixture is invalid')
      if (value.game_type_id !== 1) continue
      const game = fixture(value)
      games.push(game)
    }
    // Detect repeats even when a page consists entirely of non-regular fixtures.
    const ids = body.map((item) => item?.ID)
    if (ids.some((id) => !positiveId(id)) || new Set(ids).size !== ids.length)
      throw new Error('CFL fixture IDs are invalid')
    if (page > 1 && ids.some((id) => allIds.has(id))) throw new Error('CFL fixture page repeated')
    ids.forEach((id) => allIds.add(id))
    if (body.length < pageSize) return games
  }
  throw new Error('CFL fixture pagination exceeded its limit')
}

async function calendar(year: number, db?: D1Database) {
  // Once any week exists, its persisted key anchors every week in this season.
  const saved = db
    ? await db
        .prepare(
          'SELECT start_date, week_number FROM weekends WHERE league=? AND season=? AND week_number IS NOT NULL ORDER BY week_number LIMIT 1',
        )
        .bind('cfl', cflSeason(year))
        .first<{ start_date: string; week_number: number }>()
    : null
  const id = await seasonId(year)
  if (!id) {
    if (saved) throw new Error('CFL persisted season is unavailable')
    return { id: null, games: [], weeks: [] }
  }
  const games = await cflFixtures(id)
  if (!games.length) {
    if (saved) throw new Error('CFL regular-season fixtures unexpectedly empty')
    return { id, games, weeks: [] }
  }
  const first = games
    .filter((game) => game.week === 1)
    .map((game) => easternDate(game.start_at))
    .sort()[0]
  if (!first && !saved) throw new Error('CFL first week is missing')
  const weekday = first ? new Date(`${first}T12:00:00Z`).getUTCDay() : 0
  const anchor = saved
    ? addDays(saved.start_date, -7 * (saved.week_number - 1))
    : addDays(first!, -((weekday + 3) % 7))
  const weeks = [...new Set(games.map((game) => game.week))]
    .sort((a, b) => a - b)
    .map((number) => {
      const startDate = addDays(anchor, 7 * (number - 1))
      return {
        seasonYear: year,
        number,
        startDate,
        opensAt: easternTimeAt(addDays(startDate, -2), 8),
        closesAt: easternTimeAt(addDays(startDate, 5), 8),
      }
    })
  return { id, games, weeks }
}
export async function cflWeekContext(
  now = Date.now(),
  db?: D1Database,
): Promise<{
  active: CflWeek | null
  next: CflWeek | null
  offseason: boolean
}> {
  const year = Number(easternDate(now).slice(0, 4))
  const { weeks } = await calendar(year, db)
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
async function teams(): Promise<Map<number, CflTeam>> {
  const body = await cfl('/teams')
  if (!Array.isArray(body) || !body.length) throw new Error('CFL teams are invalid')
  const result = new Map<number, CflTeam>()
  for (const raw of body) {
    if (
      !positiveId(raw?.ID) ||
      typeof raw.abbreviation !== 'string' ||
      !/^[A-Z]{2,4}$/.test(raw.abbreviation) ||
      typeof raw.name !== 'string' ||
      !raw.name ||
      typeof raw.region_label !== 'string' ||
      !raw.region_label ||
      (raw.logo_svg != null && typeof raw.logo_svg !== 'string') ||
      result.has(raw.ID)
    )
      throw new Error('CFL team is invalid')
    result.set(raw.ID, raw)
  }
  return result
}
function cflLogo(logo: string | undefined): string | null {
  // Fix malformed charset parameters without losing Base64 payload encoding.
  return (
    logo?.replace(/^data:image\/svg\+xml[^,]*,/i, (header) =>
      /;base64,/i.test(header) ? 'data:image/svg+xml;base64,' : 'data:image/svg+xml,',
    ) ?? null
  )
}
function gameFromCfl(raw: CflFixture, byId: Map<number, CflTeam>): Game {
  function team(id: number | null) {
    const member = id ? byId.get(id) : null
    if (!member) throw new Error('CFL matchup team is missing')
    return {
      code: member.abbreviation,
      name: `${member.region_label} ${member.name}`,
      logo: cflLogo(member.logo_svg),
    }
  }
  return {
    id: raw.ID,
    sourceId: raw.ID,
    startUtc: new Date(raw.start_at).toISOString(),
    easternDate: easternDate(raw.start_at),
    away: team(raw.away_team_id),
    home: team(raw.home_team_id),
    state: 'scheduled',
    awayScore: null,
    homeScore: null,
    winner: null,
  }
}
export async function getCflSchedule(start: string, db?: D1Database): Promise<WeekSchedule> {
  const year = Number(start.slice(0, 4))
  const { games, weeks } = await calendar(year, db)
  const week = weeks.find((item) => item.startDate === start)
  if (!week) throw new Error('CFL regular-season week is unavailable')
  const byId = await teams()
  return {
    games: games.filter((game) => game.week === week.number).map((game) => gameFromCfl(game, byId)),
    season: cflSeason(year),
    weekNumber: week.number,
    opensAt: week.opensAt,
  }
}
function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
export function resultFromCfl(
  raw: CflFixture,
  expectedWeek: number,
  expectedSeason: number,
): GameResult | null {
  if (
    raw.week !== expectedWeek ||
    raw.season_id !== expectedSeason ||
    raw.game_type_id !== 1 ||
    /^(cancelled|canceled|postponed|suspended)$/i.test(raw.game_status ?? '')
  )
    return { state: 'void', awayScore: null, homeScore: null, winner: null }
  const awayScore = score(raw.away_team_score)
  const homeScore = score(raw.home_team_score)
  if (/^finished$/i.test(raw.game_status ?? '')) {
    if (awayScore === null || homeScore === null) return null
    if (awayScore === homeScore)
      return { state: 'void', awayScore: null, homeScore: null, winner: null }
    return { state: 'final', awayScore, homeScore, winner: awayScore > homeScore ? 'away' : 'home' }
  }
  if (/^(live|in progress|inprogress|playing|halftime)$/i.test(raw.game_status ?? ''))
    return { state: 'live', awayScore, homeScore, winner: null }
  if (!raw.game_status || /^(scheduled|not started|pre-game|pregame)$/i.test(raw.game_status))
    return { state: 'scheduled', awayScore: null, homeScore: null, winner: null }
  return null
}
export async function getCflResults(week: Weekend): Promise<Map<number, GameResult>> {
  if (!week.weekNumber) throw new Error('CFL week number is missing')
  const id = await seasonId(Number(week.season.slice(0, 4)))
  if (!id) throw new Error('CFL season is unavailable')
  const games = await cflFixtures(id)
  const byId = new Map(games.map((game) => [game.ID, game]))
  const results = new Map<number, GameResult>()
  for (const game of week.games) {
    let raw = byId.get(game.sourceId)
    if (!raw) {
      try {
        raw = fixture(await cfl(`/fixtures/${game.sourceId}`))
      } catch {
        continue
      }
    }
    const result = resultFromCfl(raw, week.weekNumber, id)
    if (result) results.set(game.sourceId, result)
  }
  return results
}
export async function getCflRecords(season: string): Promise<Map<string, string>> {
  const body = (await cfl(`/standings/${Number(season.slice(0, 4))}`)) as {
    data?: {
      divisions?: {
        unified?: {
          standings?: { abbreviation: string; wins: number; losses: number; ties: number }[]
        }
      }
    }
  }
  const rows = body?.data?.divisions?.unified?.standings
  if (!Array.isArray(rows) || !rows.length) throw new Error('CFL standings are invalid')
  const records = new Map<string, string>()
  for (const row of rows) {
    if (
      typeof row?.abbreviation !== 'string' ||
      !/^[A-Z]{2,4}$/.test(row.abbreviation) ||
      [row.wins, row.losses, row.ties].some((value) => score(value) === null) ||
      records.has(row.abbreviation)
    )
      throw new Error('CFL team record is invalid')
    records.set(row.abbreviation, `${row.wins}-${row.losses}-${row.ties}`)
  }
  return records
}

export async function cflWeekByStart(start: string, db?: D1Database): Promise<CflWeek | null> {
  const { weeks } = await calendar(Number(start.slice(0, 4)), db)
  return weeks.find((week) => week.startDate === start) ?? null
}
