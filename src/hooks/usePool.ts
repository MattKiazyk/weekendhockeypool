import { useEffect, useState } from 'react'
import { emptyPool, fetchJson, sendJson, type PoolData } from '../lib/api'
import { getDemoData, readDemoEntry, saveDemoEntry } from '../lib/demo'
import {
  hasEntryDeadlinePassed,
  type Entry,
  type Pick,
  type PublicPick,
  type Standing,
  type Weekend,
  type WeekendStatus,
  type WeekListing,
} from '../lib/pool'
import type { PoolSession } from '../lib/session'

export function usePool(
  session: PoolSession,
  demo: boolean,
  stage: WeekendStatus,
  showEntrants: boolean,
) {
  const { signedIn, userId, username, getToken } = session
  const [data, setData] = useState<PoolData>(emptyPool)
  const [draft, setDraft] = useState<Pick[]>([])
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!demo) return
    const entry = signedIn ? readDemoEntry() : null
    setData({ ...emptyPool, entry })
    setDraft(entry?.picks ?? [])
  }, [demo, signedIn])

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    const options = { signal: controller.signal }
    async function load() {
      setLoading(true)
      setError('')
      // Do not carry a previous player's entry into a failed account/week load.
      setData(emptyPool)
      setDraft([])
      try {
        const suffix = selectedWeek ? `?start=${selectedWeek}` : ''
        const [{ week }, token] = await Promise.all([
          fetchJson<{ week: Weekend | null }>(`/api/week${suffix}`, null, options),
          signedIn ? getToken() : Promise.resolve(null),
        ])
        if (controller.signal.aborted) return
        // Loading the current week can publish a new slate, so list it afterward.
        const weeksRequest = fetchJson<{ weeks: WeekListing[] }>('/api/weeks', null, options)
        if (!week) {
          const { weeks } = await weeksRequest
          if (controller.signal.aborted) return
          setData({ ...emptyPool, weeks })
          return
        }
        const [{ weeks }, { standings }, season, { entrants }, own, revealed] = await Promise.all([
          weeksRequest,
          fetchJson<{ standings: Standing[] }>(
            `/api/standings?start=${week.startDate}`,
            null,
            options,
          ),
          fetchJson<{ standings: Standing[] }>(`/api/season?season=${week.season}`, null, options),
          fetchJson<{ entrants: string[] }>(`/api/entrants?start=${week.startDate}`, null, options),
          token
            ? fetchJson<{ entry: Entry | null }>(
                `/api/entry?start=${week.startDate}`,
                token,
                options,
              )
            : { entry: null },
          token && hasEntryDeadlinePassed(week)
            ? fetchJson<{ picks: PublicPick[] }>(
                `/api/picks?start=${week.startDate}`,
                token,
                options,
              )
            : { picks: [] },
        ])
        if (controller.signal.aborted) return
        setData({
          week,
          weeks,
          standings,
          seasonStandings: season.standings,
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
  }, [demo, selectedWeek, signedIn, userId, getToken, reloadKey])

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
          `/api/entrants?start=${startDate}`,
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
  }, [pollEntrants, startDate])

  const visibleData = demo ? getDemoData(stage, data.entry, username) : data

  async function saveEntry(): Promise<void> {
    if (!visibleData.week) return
    const timestamp = new Date().toISOString()
    const saved: Entry = {
      picks: draft,
      submittedAt: data.entry?.submittedAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (demo) {
      saveDemoEntry(saved)
    } else {
      const result = await sendJson<{ updatedAt: string }>('/api/entry', await getToken(), 'PUT', {
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
    await sendJson(`/api/admin/${path}`, await getToken(), 'POST', { startDate, ...payload })
    setReloadKey((value) => value + 1)
  }

  return {
    ...visibleData,
    draft,
    setDraft,
    selectedWeek,
    setSelectedWeek,
    loading,
    error,
    setError,
    clock,
    saveEntry,
    adminAction,
  }
}
