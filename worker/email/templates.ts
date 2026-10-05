import { formatDay, formatDeadline } from '../../src/lib/format'
import { leagueLabel } from '../../src/lib/leagues'
import type { LeagueId, Weekend } from '../../src/lib/pool'
import { viewUrl } from '../../src/lib/views'

export const site = 'https://weeklypools.ca'
const settingsUrl = viewUrl('email-settings', site)
export interface RecapRow {
  clerkId: string
  username: string
  rank: number
  points: number
  correct: number
}
export interface RecapPayload {
  title: string
  standings: RecapRow[]
}
export interface EmailContent {
  subject: string
  html: string
  text: string
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}
export function weekTitle(
  week: Pick<Weekend, 'league' | 'startDate' | 'weekNumber' | 'season'>,
): string {
  return week.league === 'nfl'
    ? `NFL ${week.season.slice(0, 4)} · Week ${week.weekNumber}`
    : `${leagueLabel(week.league)} · Weekend of ${formatDay(week.startDate)}, ${week.startDate.slice(0, 4)}`
}
export function weekLink(league: LeagueId, start: string, view: 'picks' | 'standings'): string {
  return viewUrl(view, `${site}/?league=${league}&start=${encodeURIComponent(start)}`)
}
function wrap(subject: string, body: string, text: string, welcome = false): EmailContent {
  const footer = `${welcome ? 'This is a one-time account welcome email. ' : ''}You can change league reminder and recap emails in Email Settings. Replies to this address are not monitored.`
  return {
    subject,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f2f4f6;color:#152438;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:20px 12px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:#fff;border-collapse:collapse"><tr><td style="padding:24px;background:#152438;color:#fff"><img src="${site}/logo-concepts/04-center-ice-roundel.png" width="48" height="48" alt="" style="vertical-align:middle;margin-right:12px"><strong>WEEKLY POOLS</strong></td></tr><tr><td style="padding:24px;line-height:1.6">${body}</td></tr><tr><td style="padding:24px;border-top:1px solid #dce2e8;font-size:12px;line-height:1.6;color:#526174">${escapeHtml(footer)} <a href="${settingsUrl}" style="color:#1765a5">Email Settings</a><br>For fun only · Free to play · No betting, money, or prizes.</td></tr></table></td></tr></table></body></html>`,
    text: `${text}\n\n${footer}\nEmail Settings: ${settingsUrl}\nFor fun only. Free to play. No betting, money, or prizes.`,
  }
}
function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:#1765a5">${escapeHtml(label)}</a>`
}
export function welcomeEmail(username: string | null): EmailContent {
  const greeting = username ? `Welcome, ${username}!` : 'Welcome to Weekly Pools!'
  const copy =
    'We’re glad you’re here. Weekly Pools is a friendly way to make your calls and enjoy the games together. It’s free and just for fun: no betting, money, or prizes.'
  const rules = [
    'Choose a winner for every game in your league’s pick sheet.',
    'Give each game a different confidence number, from 1 to the number of games. Put your biggest number on the pick you feel best about.',
    'A correct pick earns its confidence number in points. Void games earn zero.',
    'Save your complete entry before the first game starts. That first-game deadline locks all picks for the week.',
    'NHL and PWHL pools cover Friday–Sunday games and open Monday at 8 a.m. Eastern. NFL pools follow official regular-season weeks and open Tuesday at 8 a.m. Eastern. Each league has its own entry and standings.',
  ]
  return wrap(
    'Welcome to Weekly Pools!',
    `<h1 style="font-size:26px">${escapeHtml(greeting)}</h1><p>${escapeHtml(copy)}</p><ol>${rules.map((rule) => `<li style="margin-bottom:12px">${escapeHtml(rule)}</li>`).join('')}</ol><p>Ready to make your calls? ${link(viewUrl('picks', site), 'Visit My Picks')} or ${link(viewUrl('about', site), 'read the playbook')}.</p><p>Want weekly reminders and recaps? They start off. Choose your leagues in ${link(settingsUrl, 'Email Settings')}.</p>`,
    `${greeting}\n\n${copy}\n\n${rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}\n\nMy Picks: ${viewUrl('picks', site)}\nPlaybook: ${viewUrl('about', site)}\nOptional reminders and recaps start off.`,
    true,
  )
}
export function reminderEmail(week: Weekend): EmailContent {
  const title = weekTitle(week)
  const deadline = formatDeadline(week.lockAt!)
  const copy = `There’s still time to make your calls. Your ${leagueLabel(week.league)} entry needs a winner and unique confidence number for every game.`
  const href = weekLink(week.league, week.startDate, 'picks')
  return wrap(
    `${title}: make your picks`,
    `<h1 style="font-size:26px">${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><p><strong>Save before ${escapeHtml(deadline)}.</strong> All picks lock when the first game starts.</p><p>${link(href, 'Complete your pick sheet')}</p>`,
    `${title}\n\n${copy}\nSave before ${deadline}. All picks lock when the first game starts.\n\nComplete your pick sheet: ${href}`,
  )
}
export function recapEmail(
  payload: RecapPayload,
  userId: string,
  entered: boolean,
  league: LeagueId,
  start: string,
): EmailContent {
  const own = payload.standings.find((row) => row.clerkId === userId)
  const rows = payload.standings.filter((row) => row.rank <= 10)
  if (own && own.rank > 10) rows.push(own)
  const personal = own
    ? `You finished at rank ${own.rank} with ${own.points} points and ${own.correct} correct picks.`
    : entered
      ? 'Your entry did not qualify for standings because it was incomplete at lock.'
      : 'You didn’t enter this week. Join the next pool to make your calls!'
  const table = rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><caption style="text-align:left;font-weight:bold;padding:12px 0">Top 10 ranks${own && own.rank > 10 ? ' and your result' : ''}</caption><thead><tr>${['Rank', 'Player', 'Points', 'Correct'].map((heading) => `<th scope="col" style="text-align:left;padding:8px 4px;border-bottom:2px solid #dce2e8">${heading}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr style="${row.clerkId === userId ? 'background:#edf5fc;font-weight:bold' : ''}"><td style="padding:8px 4px">${row.rank}</td><td style="padding:8px 4px;overflow-wrap:anywhere">${escapeHtml(row.username)}</td><td style="padding:8px 4px">${row.points}</td><td style="padding:8px 4px">${row.correct}</td></tr>`).join('')}</tbody></table>`
    : '<p>No qualifying entries this week.</p>'
  const href = weekLink(league, start, 'standings')
  return wrap(
    `${payload.title}: final standings`,
    `<h1 style="font-size:26px">${escapeHtml(payload.title)}</h1><p>The games are done and the standings are in. Thanks for playing!</p><p>${escapeHtml(personal)}</p>${table}<p>${link(href, 'View full standings')}</p><p>This recap reflects the standings when first published. Visit the website for any later corrections.</p>`,
    `${payload.title}: final standings\n\n${personal}\n\nRank | Player | Points | Correct\n${rows.map((row) => `${row.rank} | ${row.username} | ${row.points} | ${row.correct}`).join('\n') || 'No qualifying entries this week.'}\n\nView full standings: ${href}\nThis recap reflects the standings when first published. Visit the website for later corrections.`,
  )
}
