import { describe, expect, it, vi } from 'vitest'
import { navigateAfterAuth, signInReturnUrls } from '../src/lib/auth-navigation'

function mockLocation(href: string) {
  return { href, reload: vi.fn(), assign: vi.fn(), replace: vi.fn() } as unknown as Location
}

describe('authentication navigation', () => {
  const href = 'https://weeklypools.ca/standings?league=nfl&start=2026-10-01'

  it('returns both sign-in and sign-up to the selected league, week, and view', () => {
    expect(signInReturnUrls(href)).toEqual({
      forceRedirectUrl: href,
      signUpForceRedirectUrl: href,
    })
  })

  it.each([false, true])('reloads an identical destination (replace: %s)', (replace) => {
    const location = mockLocation(href)
    navigateAfterAuth(href, replace, location)
    expect(location.reload).toHaveBeenCalledOnce()
    expect(location.assign).not.toHaveBeenCalled()
    expect(location.replace).not.toHaveBeenCalled()
  })

  it('also reloads a relative destination for the current page', () => {
    const location = mockLocation(href)
    navigateAfterAuth('/standings?league=nfl&start=2026-10-01', false, location)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  it.each([false, true])('navigates to a different destination (replace: %s)', (replace) => {
    const location = mockLocation(href)
    navigateAfterAuth('/', replace, location)
    expect(location.reload).not.toHaveBeenCalled()
    expect(replace ? location.replace : location.assign).toHaveBeenCalledWith(
      'https://weeklypools.ca/',
    )
    expect(replace ? location.assign : location.replace).not.toHaveBeenCalled()
  })
})
