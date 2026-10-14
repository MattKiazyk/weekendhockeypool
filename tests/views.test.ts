import { describe, expect, it } from 'vitest'
import { poolInviteUrl, viewFromUrl, viewUrl, views } from '../src/lib/views'

describe('page URLs', () => {
  const selected = 'https://weeklypools.ca/?league=nfl&start=2026-10-01'

  it.each(views)('opens $id directly and preserves the selected league and week', ({ id }) => {
    const url = new URL(viewUrl(id, selected))
    expect(url.pathname).toBe(id === 'picks' ? '/' : `/${id}`)
    expect(url.search).toBe('?league=nfl&start=2026-10-01')
    expect(url.hash).toBe('')
    expect(viewFromUrl(url)).toBe(id)
  })

  it.each(views)('converts a bookmarked $id hash to its page URL', ({ id }) => {
    const legacy = new URL(`${selected}#${id}`)
    const url = new URL(viewUrl(viewFromUrl(legacy), legacy.href))
    expect(url.pathname).toBe(id === 'picks' ? '/' : `/${id}`)
    expect(url.search).toBe(legacy.search)
    expect(url.hash).toBe('')
  })

  it('keeps the current origin for local development links', () => {
    expect(viewUrl('about', 'http://127.0.0.1:5173/standings?league=pwhl')).toBe(
      'http://127.0.0.1:5173/about?league=pwhl',
    )
  })

  it('uses the page path ahead of a fragment and accepts a trailing slash', () => {
    expect(viewFromUrl(new URL('https://weeklypools.ca/about/#standings'))).toBe('about')
    expect(viewFromUrl(new URL('https://weeklypools.ca/privacy/#standings'))).toBe('privacy')
    expect(viewFromUrl(new URL('https://weeklypools.ca/policy/#standings'))).toBe('privacy')
    expect(viewFromUrl(new URL('https://weeklypools.ca/#policy'))).toBe('privacy')
  })

  it.each(['/', '/unknown', '/#unknown'])('defaults %s to My Picks', (path) => {
    expect(viewFromUrl(new URL(path, 'https://weeklypools.ca'))).toBe('picks')
  })
})

it('keeps CFL numbered-week links through view navigation', () => {
  const url = new URL(viewUrl('standings', 'https://weeklypools.ca/?league=cfl&start=2026-06-04'))
  expect(url.pathname).toBe('/standings')
  expect(url.search).toBe('?league=cfl&start=2026-06-04')
})

it.each(['nhl', 'pwhl', 'nfl', 'cfl'] as const)(
  'shares a canonical %s pick sheet with only its selected league and week',
  (league) => {
    const url = new URL(poolInviteUrl(league, '2026-10-16'))
    expect(url.origin).toBe('https://weeklypools.ca')
    expect(url.pathname).toBe('/')
    expect([...url.searchParams.entries()]).toEqual([
      ['league', league],
      ['start', '2026-10-16'],
    ])
    expect(url.hash).toBe('')
  },
)
