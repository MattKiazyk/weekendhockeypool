export const views = [
  { id: 'picks', label: 'Picks', kicker: '01 / MAKE YOUR CALL', title: 'THE PICK SHEET' },
  {
    id: 'standings',
    label: 'Standings',
    kicker: '02 / THE LEADERBOARD',
    title: 'WEEKEND STANDINGS',
  },
  { id: 'season', label: 'Season', kicker: '03 / THE LONG GAME', title: 'SEASON STANDINGS' },
  { id: 'about', label: 'About', kicker: '', title: '' },
  { id: 'admin', label: 'Admin', kicker: '04 / CONTROL ROOM', title: 'ADMIN DESK' },
] as const

export type View = (typeof views)[number]['id']

export function viewFromHash(): View {
  return views.find((view) => view.id === window.location.hash.slice(1))?.id ?? 'picks'
}
