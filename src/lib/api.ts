import type { Entry, PublicPick, Standing, Weekend, WeekListing } from './pool'

export interface PoolData {
  week: Weekend | null
  weeks: WeekListing[]
  entry: Entry | null
  standings: Standing[]
  seasonStandings: Standing[]
  entrants: string[]
  publicPicks: PublicPick[]
}

export const emptyPool: PoolData = {
  week: null,
  weeks: [],
  entry: null,
  standings: [],
  seasonStandings: [],
  entrants: [],
  publicPicks: [],
}

export async function fetchJson<T>(
  url: string,
  token?: string | null,
  options?: RequestInit,
): Promise<T> {
  const headers = new Headers(options?.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...options, headers })
  const body = (await response.json()) as T & { error?: string; errors?: string[] }
  if (!response.ok) throw new Error(body.error ?? body.errors?.[0] ?? 'Request failed')
  return body
}

export function sendJson<T>(
  url: string,
  token: string | null,
  method: 'PUT' | 'POST',
  body: unknown,
): Promise<T> {
  return fetchJson(url, token, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
