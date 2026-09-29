import { useEffect, useRef, useState } from 'react'
import { emptyPool, fetchJson, sendJson, type PoolData } from '../lib/api'
import { getDemoData, readDemoEntry, saveDemoEntry, type DemoStage } from '../lib/demo'
import {
  addDays,
  easternDate,
  easternTimeAt,
  hasEntryDeadlinePassed,
  seasonFor,
  weekendStartAt,
  type CombinedStanding,
  type Entry,
  type LeagueId,
  type Pick,
  type PublicPick,
  type Standing,
  type Weekend,
  type WeekListing,
} from '../lib/pool'
import type { PoolSession } from '../lib/session'

export function usePool(
  session: PoolSession,
  league: LeagueId,
  demo: boolean,
  stage: DemoStage,
  showEntrants: boolean,
) {
  const { signedIn, userId, username, getToken } = session
  const [data, setData] = useState<PoolData>(emptyPool)
  const [dataLeague, setDataLeague] = useState<LeagueId>(league)
  const [draft, setDraft] = useState<Pick[]>([])
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now)
  const currentWeekend = weekendStartAt(clock)
  const [liveOpenLeagues, setLiveOpenLeagues] = useState<LeagueId[]>([])
  const seenNflRelease = useRef<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    async function refreshOpenLeagues() {
      try {
        const { openLeagues } = await fetchJson<{ openLeagues: LeagueId[] }>(
          '/api/open-leagues',
          null,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) setLiveOpenLeagues(openLeagues)
      } catch {
        if (!controller.signal.aborted) setLiveOpenLeagues([])
      }
    }
    void refreshOpenLeagues()
    const timer = window.setInterval(() => void refreshOpenLeagues(), 30000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [demo, league, loading, reloadKey])

  useEffect(() => {
    if (demo || league !== 'nfl' || selectedWeek) {
      seenNflRelease.current = null
      return
    }
    const today = easternDate(clock)
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
    const tuesday = addDays(today, 2 - weekday)
    const currentRelease = easternTimeAt(tuesday, 8)
    const marker =
      clock >= Date.parse(currentRelease) ? currentRelease : easternTimeAt(addDays(tuesday, -7), 8)
    if (seenNflRelease.current && seenNflRelease.current !== marker)
      setReloadKey((value) => value + 1)
    seenNflRelease.current = marker
  }, [clock, demo, league, selectedWeek])

  useEffect(() => {
    if (!demo) return
    const entry = signedIn && league !== 'pwhl' ? readDemoEntry(league, selectedWeek) : null
    setData({ ...emptyPool, entry })
    setDraft(entry?.picks ?? [])
  }, [demo, league, signedIn, selectedWeek])

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    const options = { signal: controller.signal }
    async function load() {
      setLoading(true)
      setError('')
      // Do not carry a previous player's entry into a failed account/week load.
      setData(emptyPool)
      setDataLeague(league)
      setDraft([])
      try {
        const suffix = `?league=${league}${selectedWeek ? `&start=${selectedWeek}` : ''}`
        const [{ week, nflOffseason }, token] = await Promise.all([
          fetchJson<{ week: Weekend | null; nflOffseason: boolean }>(
            `/api/week${suffix}`,
            null,
            options,
          ),
          signedIn ? getToken() : Promise.resolve(null),
        ])
        if (controller.signal.aborted) return
        // Loading the current week can publish a new slate, so list it afterward.
        const { weeks } = await fetchJson<{ weeks: WeekListing[] }>(
          `/api/weeks?league=${league}`,
          null,
          options,
        )
        const seasonId =
          week?.season ??
          (league === 'nfl' ? weeks[0]?.season : null) ??
          seasonFor(selectedWeek ?? currentWeekend)
        const seasonRequest = fetchJson<{ standings: Standing[] }>(
          `/api/season?league=${league}&season=${seasonId}`,
          null,
          options,
        )
        const combinedRequest = fetchJson<{ standings: CombinedStanding[] }>(
          `/api/season?league=all&season=${seasonId}`,
          null,
          options,
        )
        if (!week) {
          const [season, combined] = await Promise.all([seasonRequest, combinedRequest])
          if (controller.signal.aborted) return
          setData({
            ...emptyPool,
            nflOffseason,
            weeks,
            seasonStandings: season.standings,
            combinedStandings: combined.standings,
          })
          return
        }
        const [{ standings }, season, combined, { entrants }, own, revealed] = await Promise.all([
          fetchJson<{ standings: Standing[] }>(
            `/api/standings?league=${league}&start=${week.startDate}`,
            null,
            options,
          ),
          seasonRequest,
          combinedRequest,
          fetchJson<{ entrants: string[] }>(
            `/api/entrants?league=${league}&start=${week.startDate}`,
            null,
            options,
          ),
          token
            ? fetchJson<{ entry: Entry | null }>(
                `/api/entry?league=${league}&start=${week.startDate}`,
                token,
                options,
              )
            : { entry: null },
          token && hasEntryDeadlinePassed(week)
            ? fetchJson<{ picks: PublicPick[] }>(
                `/api/picks?league=${league}&start=${week.startDate}`,
                token,
                options,
              )
            : { picks: [] },
        ])
        if (controller.signal.aborted) return
        setData({
          week,
          nflOffseason,
          weeks,
          standings,
          seasonStandings: season.standings,
          combinedStandings: combined.standings,
          entrants,
          entry: own.entry,
          publicPicks: revealed.picks,
        })
        setDraft(own.entry?.picks ?? [])
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load the pool')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [demo, league, selectedWeek, signedIn, userId, getToken, reloadKey, currentWeekend])

  const deadlinePassed =
    !demo && data.week?.status === 'open' && hasEntryDeadlinePassed(data.week, clock)
  useEffect(() => {
    if (deadlinePassed) setReloadKey((value) => value + 1)
  }, [deadlinePassed])

  const startDate = data.week?.startDate
  const pollEntrants = !demo && showEntrants && data.week?.status === 'open' && !deadlinePassed
  useEffect(() => {
    if (!pollEntrants || !startDate) return
    const controller = new AbortController()
    async function refreshEntrants() {
      try {
        const { entrants } = await fetchJson<{ entrants: string[] }>(
          `/api/entrants?league=${league}&start=${startDate}`,
          null,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) setData((previous) => ({ ...previous, entrants }))
      } catch {
        /* Keep the last successful list if polling fails. */
      }
    }
    const timer = window.setInterval(() => void refreshEntrants(), 30000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [pollEntrants, startDate, league])

  const visibleData = demo
    ? getDemoData(league, stage, data.entry, username, selectedWeek)
    : dataLeague === league
      ? data
      : emptyPool

  async function saveEntry(): Promise<void> {
    if (!visibleData.week) return
    const timestamp = new Date().toISOString()
    const saved: Entry = {
      picks: draft,
      submittedAt: data.entry?.submittedAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (demo) {
      saveDemoEntry(saved, league, selectedWeek)
    } else {
      const result = await sendJson<{ updatedAt: string }>('/api/entry', await getToken(), 'PUT', {
        league,
        startDate: visibleData.week.startDate,
        picks: draft,
      })
      saved.updatedAt = result.updatedAt
    }
    setData((previous) => ({
      ...previous,
      entry: saved,
      entrants: username
        ? [...new Set([...previous.entrants, username])].sort((a, b) => a.localeCompare(b))
        : previous.entrants,
    }))
  }

  async function adminAction(
    startDate: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await sendJson(`/api/admin/${path}`, await getToken(), 'POST', {
      league,
      startDate,
      ...payload,
    })
    setReloadKey((value) => value + 1)
  }

  return {
    ...visibleData,
    openLeagues: demo ? (stage === 'open' ? (['nhl', 'nfl'] as LeagueId[]) : []) : liveOpenLeagues,
    draft,
    setDraft,
    selectedWeek,
    setSelectedWeek,
    loading: loading || (!demo && dataLeague !== league),
    error,
    setError,
    clock,
    saveEntry,
    adminAction,
  }
}
