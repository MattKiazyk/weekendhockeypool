export const views = [
  { id: 'picks', label: 'My Picks', kicker: '01 / MAKE YOUR CALL', title: 'THE PICK SHEET' },
  {
    id: 'standings',
    label: 'Standings',
    kicker: '02 / THE LEADERBOARD',
    title: 'WEEK STANDINGS',
  },
  { id: 'season', label: 'Season', kicker: '03 / THE LONG GAME', title: 'SEASON STANDINGS' },
  { id: 'about', label: 'About', kicker: '', title: '' },
  { id: 'email-settings', label: 'Email Settings', kicker: '', title: 'EMAIL SETTINGS' },
  { id: 'admin', label: 'Admin', kicker: '04 / CONTROL ROOM', title: 'ADMIN DESK' },
  { id: 'privacy', label: 'Privacy Policy', kicker: '', title: 'PRIVACY POLICY' },
  { id: 'terms', label: 'Terms of Service', kicker: '', title: 'TERMS OF SERVICE' },
] as const

export type View = (typeof views)[number]['id']

export function viewFromUrl(location: Pick<Location, 'pathname' | 'hash'> = window.location): View {
  const path = location.pathname.replace(/\/$/, '')
  const id = path ? path.slice(1) : location.hash.slice(1)
  if (id === 'policy') return 'privacy'
  return views.find((view) => view.id === id)?.id ?? 'picks'
}

export function viewUrl(view: View, href = window.location.href): string {
  const url = new URL(href)
  url.pathname = view === 'picks' ? '/' : `/${view}`
  url.hash = ''
  return url.href
}

export function selectedStartFromUrl(): string | null {
  const start = new URLSearchParams(window.location.search).get('start')
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  const date = new Date(`${start}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) return null
  const league = new URLSearchParams(window.location.search).get('league')
  return date.getUTCDay() === (league === 'nfl' ? 4 : 5) ? start : null
}
