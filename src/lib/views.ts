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
] as const

export type View = (typeof views)[number]['id']

export function viewFromHash(): View {
  return views.find((view) => view.id === window.location.hash.slice(1))?.id ?? 'picks'
}

export function selectedStartFromUrl(): string | null {
  const start = new URLSearchParams(window.location.search).get('start')
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  const date = new Date(`${start}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) return null
  const league = new URLSearchParams(window.location.search).get('league')
  return date.getUTCDay() === (league === 'nfl' ? 4 : 5) ? start : null
}
