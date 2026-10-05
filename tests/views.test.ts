import { describe, expect, it } from 'vitest'
import { viewFromUrl, viewUrl, views } from '../src/lib/views'

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
  })

  it.each(['/', '/unknown', '/#unknown'])('defaults %s to My Picks', (path) => {
    expect(viewFromUrl(new URL(path, 'https://weeklypools.ca'))).toBe('picks')
  })
})
