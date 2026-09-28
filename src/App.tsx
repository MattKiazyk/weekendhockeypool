import { useEffect, useMemo, useState } from 'react'
import About from './About'
import demoSchedule from './demo-schedule.json'
import { addDays, hasEntryDeadlinePassed, isEntryOpen, rankScores, scoreEntry, seasonFor, validatePicks, weekendStartAt, type Entry, type Game, type Pick, type Side, type Standing, type Weekend } from './lib/pool'

export interface PoolSession {
  signedIn: boolean
  userId: string | null
  username: string | null
  isAdmin: boolean
  getToken: () => Promise<string | null>
  signIn: () => void
  signOut: () => void
  setUsername: (username: string) => Promise<void>
}

type View = 'picks' | 'standings' | 'season' | 'about' | 'admin'
type DemoStage = 'open' | 'locked' | 'final'
type SaveFeedback = { kind: 'success' | 'error'; text: string }
type PublicPick = { username: string; game_id: number; side: Side; confidence: number }
type WeekListing = { start_date: string; season: string; status: string }

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(value))
const dayIso = (date: string) => `${date}T12:00:00Z`
const formatDay = (date: string) => dateLabel(dayIso(date), { weekday: 'long', month: 'short', day: 'numeric' })
const formatTime = (iso: string) => dateLabel(iso, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const formatSlateDates = (start: string) => {
  const end = addDays(start, 2)
  const startMonth = dateLabel(dayIso(start), { month: 'short' }).toUpperCase()
  const endMonth = dateLabel(dayIso(end), { month: 'short' }).toUpperCase()
  const startDay = dateLabel(dayIso(start), { day: 'numeric' })
  const endDay = dateLabel(dayIso(end), { day: 'numeric' })
  return startMonth === endMonth ? `${startMonth} ${startDay}–${endDay}` : `${startMonth} ${startDay} – ${endMonth} ${endDay}`
}
const viewFromHash = (): View => {
  if (typeof window === 'undefined') return 'picks'
  const hash = window.location.hash.slice(1)
  return hash === 'standings' || hash === 'season' || hash === 'about' || hash === 'admin' ? hash : 'picks'
}

async function fetchJson<T>(url: string, token?: string | null, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Request failed')
  return body
}

function HockeyMark() {
  return <img className="brand-mark" src="/logo-concepts/04-center-ice-roundel.png" alt="" aria-hidden="true" />
}

function TeamButton({ game, side, selected, disabled, onClick }: { game: Game; side: Side; selected: boolean; disabled: boolean; onClick: () => void }) {
  const team = game[side]
  return <button type="button" className={`team-button ${side} ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onClick} aria-pressed={selected} aria-label={`Pick ${team.name} to win`}>
    {side === 'away' && <span className="pick-indicator" aria-hidden="true">{selected ? '✓' : '+'}</span>}
    {team.logo ? <img src={team.logo} alt="" className="team-logo" loading="lazy" /> : <span className="team-fallback">{team.code}</span>}
    <span className="team-copy"><strong>{team.name}</strong><small className="team-role">{side.toUpperCase()}{game.state === 'final' ? ` · ${side === 'away' ? game.awayScore : game.homeScore}` : ''}</small></span>
    {side === 'home' && <span className="pick-indicator" aria-hidden="true">{selected ? '✓' : '+'}</span>}
  </button>
}

function Matchup({ game, pick, allPicks, count, editable, onPick }: { game: Game; pick?: Pick; allPicks: Pick[]; count: number; editable: boolean; onPick: (next: Pick) => void }) {
  const [showNumbers, setShowNumbers] = useState(false)
  const usedElsewhere = new Set(allPicks.filter((item) => item.gameId !== game.id).map((item) => item.confidence))
  const score = game.state === 'final' ? `${game.awayScore} – ${game.homeScore}` : game.state === 'void' ? 'VOID' : 'VS'
  const selectedConfidence = pick?.confidence || 0
  const confidenceId = `confidence-${game.id}`
  const unusedCount = count - new Set(allPicks.map((item) => item.confidence).filter((number) => number > 0)).size
  return <article className={`matchup ${pick?.side ? 'has-pick' : ''}`}>
    <div className="matchup-top"><span className="game-time">{formatTime(game.startUtc)}</span><span className={`game-state ${game.state}`}>{game.state === 'scheduled' ? 'UPCOMING' : game.state.toUpperCase()}</span></div>
    <div className="matchup-grid">
      <TeamButton game={game} side="away" selected={pick?.side === 'away'} disabled={!editable} onClick={() => { onPick({ gameId: game.id, side: 'away', confidence: pick?.confidence ?? 0 }); if (!selectedConfidence) setShowNumbers(true) }} />
      <div className="versus">
        <span>{score}</span>
        <button
          type="button"
          className={`confidence-trigger ${selectedConfidence ? 'assigned' : ''}`}
          disabled={!editable || !pick?.side}
          aria-label={`${selectedConfidence ? `Confidence ${selectedConfidence}` : 'Assign confidence'} for ${game.away.name} at ${game.home.name}`}
          aria-expanded={showNumbers && editable}
          aria-controls={confidenceId}
          onClick={() => setShowNumbers((open) => !open)}
        >
          <span className="confidence-value">{selectedConfidence || '+'}</span>
          <span className="confidence-trigger-copy">{selectedConfidence ? 'POINTS' : 'ASSIGN'}</span>
        </button>
      </div>
      <TeamButton game={game} side="home" selected={pick?.side === 'home'} disabled={!editable} onClick={() => { onPick({ gameId: game.id, side: 'home', confidence: pick?.confidence ?? 0 }); if (!selectedConfidence) setShowNumbers(true) }} />
    </div>
    {showNumbers && editable && pick?.side && <div className="confidence-panel" id={confidenceId} onKeyDown={(event) => { if (event.key === 'Escape') setShowNumbers(false) }}>
      <div className="confidence-panel-heading"><strong>Choose your confidence</strong><span>{unusedCount} unused</span></div>
      <div className="confidence-grid" role="group" aria-label={`Confidence numbers for ${game.away.name} at ${game.home.name}`}>
        {Array.from({ length: count }, (_, index) => count - index).map((number) => <button
          type="button"
          key={number}
          disabled={usedElsewhere.has(number) && !selectedConfidence}
          aria-pressed={selectedConfidence === number}
          aria-label={`${number} confidence ${number === 1 ? 'point' : 'points'}${usedElsewhere.has(number) ? selectedConfidence ? ', swap with another game' : ', used on another game' : ''}`}
          className={selectedConfidence === number ? 'selected' : usedElsewhere.has(number) ? 'occupied' : ''}
          onClick={() => { onPick({ gameId: game.id, side: pick.side, confidence: number }); setShowNumbers(false) }}
        >{number}</button>)}
      </div>
      <p>{selectedConfidence ? 'Choosing a number on another game swaps the two.' : 'Higher numbers are worth more when your pick wins.'}</p>
    </div>}
  </article>
}

function StandingsList({ rows, emptyText }: { rows: Standing[]; emptyText: string }) {
  if (!rows.length) return <div className="empty-state"><span className="empty-icon">▥</span><h3>Nothing on the board yet</h3><p>{emptyText}</p></div>
  return <div className="standing-list"><div className="standing-head"><span>RANK / PLAYER</span><span>CORRECT</span><span>POINTS</span></div>{rows.map((row) => <div className={`standing-row ${row.rank <= 3 ? 'top-rank' : ''}`} key={row.username}><div><span className="rank-number">{String(row.rank).padStart(2, '0')}</span><strong>{row.username}</strong></div><span>{row.correct}</span><b>{row.points}</b></div>)}</div>
}

function EntrantsBoard({ usernames, games, picks, unlocked, canViewPicks }: { usernames: string[]; games: Game[]; picks: PublicPick[]; unlocked: boolean; canViewPicks: boolean }) {
  return <section className="entrants-board" aria-label="Submitted entries">
    <div className="entrants-heading"><div><span className="card-kicker">ON THE BOARD</span><h4>ENTRIES IN</h4></div><span>{usernames.length} {usernames.length === 1 ? 'PLAYER' : 'PLAYERS'}</span></div>
    {!usernames.length ? <div className="entrant-empty">No entries submitted yet. Names appear here as soon as players save a complete pick sheet.</div> : usernames.map((username, index) => {
      const userPicks = picks.filter((pick) => pick.username === username)
      const heading = <><span className="entrant-index">{String(index + 1).padStart(2, '0')}</span><strong>{username}</strong><span className="entrant-state">{!unlocked ? 'PICKS LOCKED' : canViewPicks ? 'VIEW PICKS ↘' : 'SIGN IN TO VIEW'}</span></>
      return unlocked && canViewPicks ? <details className="entrant-row" key={`${username}-${index}`}><summary>{heading}</summary><div className="entrant-picks">{userPicks.length ? games.map((game) => { const pick = userPicks.find((item) => item.game_id === game.id); return pick ? <div className="entrant-pick" key={game.id}><span>{game.away.name} at {game.home.name}</span><b>{game[pick.side].name}</b><em>{pick.confidence}</em></div> : null }) : <p>Picks are loading. Try opening this entry again shortly.</p>}</div></details> : <div className="entrant-row closed" key={`${username}-${index}`}>{heading}</div>
    })}
    {!unlocked && !!usernames.length && <p className="entrants-note">Usernames are visible now. Picks open after the entry deadline.</p>}
  </section>
}

function demoFinalGames(games: Game[]): Game[] {
  return games.map((game, index) => ({ ...game, state: 'final', awayScore: index % 3 === 0 ? 4 : 2, homeScore: index % 3 === 0 ? 2 : 4, winner: index % 3 === 0 ? 'away' : 'home' }))
}

function App({ session, demo }: { session: PoolSession; demo: boolean }) {
  const [view, setView] = useState<View>(viewFromHash)
  const [stage, setStage] = useState<DemoStage>('open')
  const [week, setWeek] = useState<Weekend | null>(demo ? demoSchedule as unknown as Weekend : null)
  const [weeks, setWeeks] = useState<WeekListing[]>([])
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [draft, setDraft] = useState<Pick[]>([])
  const [standings, setStandings] = useState<Standing[]>([])
  const [seasonStandings, setSeasonStandings] = useState<Standing[]>([])
  const [entrants, setEntrants] = useState<string[]>([])
  const [publicPicks, setPublicPicks] = useState<PublicPick[]>([])
  const [loading, setLoading] = useState(!demo)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null)
  const [saveToastVisible, setSaveToastVisible] = useState(false)
  const [alias, setAlias] = useState('')
  const [adminGameId, setAdminGameId] = useState('')
  const [adminAway, setAdminAway] = useState('')
  const [adminHome, setAdminHome] = useState('')
  const [adminState, setAdminState] = useState<'final' | 'void'>('final')
  const [clock, setClock] = useState(Date.now())
  const [newGameId, setNewGameId] = useState('')
  const [newStartUtc, setNewStartUtc] = useState('')
  const [newAwayCode, setNewAwayCode] = useState('')
  const [newAwayName, setNewAwayName] = useState('')
  const [newHomeCode, setNewHomeCode] = useState('')
  const [newHomeName, setNewHomeName] = useState('')

  useEffect(() => {
    if (!demo) return
    if (!session.signedIn) { setEntry(null); setDraft([]); return }
    const saved = localStorage.getItem('hockey-pool-demo-entry')
    if (saved) {
      try { const parsed = JSON.parse(saved) as Entry; setEntry(parsed); setDraft(parsed.picks) } catch { /* ignore invalid local preview data */ }
    }
  }, [demo, session.signedIn])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!saveFeedback || !saveToastVisible) return
    const timer = window.setTimeout(() => setSaveToastVisible(false), 8000)
    return () => window.clearTimeout(timer)
  }, [saveFeedback, saveToastVisible])

  useEffect(() => {
    if (demo) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const suffix = selectedWeek ? `?start=${selectedWeek}` : ''
        const weekResponse = await fetchJson<{ week: Weekend | null }>(`/api/week${suffix}`)
        const current = weekResponse.week
        if (cancelled) return
        setWeek(current)
        const list = await fetchJson<{ weeks: WeekListing[] }>('/api/weeks')
        if (cancelled) return
        setWeeks(list.weeks)
        if (!current) return
        const token = session.signedIn ? await session.getToken() : null
        const picksUnlocked = hasEntryDeadlinePassed(current)
        const requests: Promise<unknown>[] = [
          fetchJson<{ standings: Standing[] }>(`/api/standings?start=${current.startDate}`),
          fetchJson<{ standings: Standing[] }>(`/api/season?season=${current.season}`),
          fetchJson<{ entrants: string[] }>(`/api/entrants?start=${current.startDate}`),
        ]
        if (token) requests.push(fetchJson<{ entry: Entry | null }>(`/api/entry?start=${current.startDate}`, token))
        if (token && picksUnlocked) requests.push(fetchJson<{ picks: PublicPick[] }>(`/api/picks?start=${current.startDate}`, token))
        const results = await Promise.all(requests)
        if (cancelled) return
        setStandings((results[0] as { standings: Standing[] }).standings)
        setSeasonStandings((results[1] as { standings: Standing[] }).standings)
        setEntrants((results[2] as { entrants: string[] }).entrants)
        const own = token ? (results[3] as { entry: Entry | null }).entry : null
        setEntry(own)
        setDraft(own?.picks ?? [])
        setPublicPicks(token && picksUnlocked ? (results[4] as { picks: PublicPick[] }).picks : [])
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the pool') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [demo, selectedWeek, session.signedIn, session.userId, reloadKey])

  const deadlinePassed = !demo && !!week && week.status === 'open' && !!week.lockAt && clock >= Date.parse(week.lockAt)
  useEffect(() => {
    if (deadlinePassed) setReloadKey((value) => value + 1)
  }, [deadlinePassed])

  const shownWeek = useMemo(() => {
    if (!week) {
      if (view === 'admin' && session.isAdmin) {
        const startDate = selectedWeek ?? weekendStartAt(Date.now())
        return { startDate, season: seasonFor(startDate), lockAt: null, status: 'open' as const, finalizedAt: null, games: [] }
      }
      return null
    }
    return demo ? { ...week, status: stage, games: stage === 'final' ? demoFinalGames(week.games) : week.games } : week
  }, [week, stage, demo, view, session.isAdmin, selectedWeek])
  const games = shownWeek?.games ?? []
  const open = !!shownWeek && (demo ? shownWeek.status === 'open' : isEntryOpen(shownWeek, clock))
  const displayStatus = shownWeek?.status === 'open' && !open ? 'locked' : shownWeek?.status
  const picksUnlocked = !!shownWeek && (demo ? shownWeek.status !== 'open' : hasEntryDeadlinePassed(shownWeek, clock))
  useEffect(() => {
    if (demo || view !== 'standings' || displayStatus !== 'open' || !shownWeek) return
    let cancelled = false
    const refreshEntrants = async () => {
      try {
        const result = await fetchJson<{ entrants: string[] }>(`/api/entrants?start=${shownWeek.startDate}`)
        if (!cancelled) setEntrants(result.entrants)
      } catch { /* keep the last valid list while the feed is unavailable */ }
    }
    void refreshEntrants()
    const timer = window.setInterval(() => void refreshEntrants(), 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [demo, view, displayStatus, shownWeek?.startDate])
  const pickedCount = draft.filter((pick) => pick.side && pick.confidence > 0).length
  const errors = validatePicks(draft, games)
  const remaining = Array.from({ length: games.length }, (_, index) => games.length - index).filter((number) => !draft.some((pick) => pick.confidence === number))
  const demoRows = useMemo(() => {
    if (!shownWeek || stage !== 'final') return []
    const ownScore = scoreEntry(entry?.picks ?? [], shownWeek.games)
    return rankScores([{ username: 'blue_line', points: 146, correct: 13 }, { username: 'north_end', points: 131, correct: 12 }, { username: session.username ?? 'rinkside_77', ...ownScore }, { username: 'hat_trick', points: 97, correct: 9 }])
  }, [shownWeek, stage, entry, session.username])
  const visibleStandings = demo ? demoRows : standings
  const visibleSeason = demo ? rankScores([{ username: 'blue_line', points: 684, correct: 61 }, { username: 'north_end', points: 648, correct: 58 }, { username: session.username ?? 'rinkside_77', points: 612, correct: 56 }, { username: 'hat_trick', points: 571, correct: 50 }]) : seasonStandings
  const visibleEntrants = demo ? [...new Set(['blue_line', 'north_end', 'hat_trick', ...(entry && session.username ? [session.username] : [])])].sort((a, b) => a.localeCompare(b)) : entrants
  const demoPublicPicks: PublicPick[] = demo && stage !== 'open' ? [
    ...(['blue_line', 'north_end', 'hat_trick'] as const).flatMap((username, playerIndex) => games.map((game, index) => ({ username, game_id: game.id, side: (index + playerIndex) % 2 ? 'home' as const : 'away' as const, confidence: (index + playerIndex * 4) % games.length + 1 }))),
    ...(entry && session.username ? entry.picks.map((pick) => ({ username: session.username!, game_id: pick.gameId, side: pick.side, confidence: pick.confidence })) : []),
  ] : []
  const visiblePublicPicks = demo ? demoPublicPicks : publicPicks
  const groupedPicks = publicPicks.reduce<Record<string, PublicPick[]>>((groups, pick) => {
    (groups[pick.username] ??= []).push(pick)
    return groups
  }, {})

  function updatePick(next: Pick) {
    setMessage('')
    setSaveFeedback(null)
    setSaveToastVisible(false)
    setDraft((previous) => {
      const current = previous.find((pick) => pick.gameId === next.gameId)
      const occupied = next.confidence > 0 ? previous.find((pick) => pick.gameId !== next.gameId && pick.confidence === next.confidence) : undefined
      const other = occupied && current?.confidence ? { ...occupied, confidence: current.confidence } : undefined
      return [...previous.filter((pick) => pick.gameId !== next.gameId && pick.gameId !== occupied?.gameId), next, ...(other ? [other] : [])]
    })
  }

  function navigateView(next: View) {
    setView(next)
    window.location.hash = next
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  async function saveEntry() {
    if (!shownWeek || errors.length) return
    setSaving(true); setError(''); setMessage(''); setSaveFeedback(null); setSaveToastVisible(false)
    try {
      const timestamp = new Date().toISOString()
      if (demo) {
        const saved: Entry = { picks: draft, submittedAt: entry?.submittedAt ?? timestamp, updatedAt: timestamp }
        localStorage.setItem('hockey-pool-demo-entry', JSON.stringify(saved))
        setEntry(saved)
      } else {
        const token = await session.getToken()
        await fetchJson('/api/entry', token, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: shownWeek.startDate, picks: draft }) })
        setEntry({ picks: draft, submittedAt: entry?.submittedAt ?? timestamp, updatedAt: timestamp })
      }
      setSaveFeedback({ kind: 'success', text: 'Your picks are saved. You can update them until the deadline.' })
      setSaveToastVisible(true)
      if (!demo && session.username) setEntrants((previous) => [...new Set([...previous, session.username!])].sort((a, b) => a.localeCompare(b)))
    } catch (cause) {
      setSaveFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'Could not save picks' })
      setSaveToastVisible(true)
    }
    finally { setSaving(false) }
  }

  async function changeAlias() {
    try { await session.setUsername(alias.trim()); setAlias(''); setMessage('Your public username is set.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not set username') }
  }

  async function adminAction(path: string, payload: Record<string, unknown> = {}) {
    if (!shownWeek) return
    setSaving(true); setError(''); setMessage('')
    try {
      const token = await session.getToken()
      const result = await fetchJson<{ week: Weekend }>(`/api/admin/${path}`, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: shownWeek.startDate, ...payload }) })
      setWeek(result.week)
      setMessage('Admin change saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Admin change failed') }
    finally { setSaving(false) }
  }

  return <div className="site-shell">
    {demo && <div className="demo-bar"><span><b>LOCAL DESIGN PREVIEW</b> · Sample NHL schedule · Picks stay in this browser</span><div className="demo-stages"><span>View state</span>{(['open', 'locked', 'final'] as const).map((item) => <button key={item} className={stage === item ? 'active' : ''} onClick={() => setStage(item)}>{item}</button>)}</div></div>}
    <header className="site-header"><div className="header-inner"><a href="#picks" className="brand" onClick={(event) => { event.preventDefault(); navigateView('picks') }}><HockeyMark /><span><b>WEEKEND <span className="brand-blue">HOCKEY POOL</span></b></span></a><nav className="main-nav" aria-label="Main navigation"><button className={view === 'picks' ? 'active' : ''} onClick={() => navigateView('picks')}>Picks</button><button className={view === 'standings' ? 'active' : ''} onClick={() => navigateView('standings')}>Standings</button><button className={view === 'season' ? 'active' : ''} onClick={() => navigateView('season')}>Season</button><button className={view === 'about' ? 'active' : ''} onClick={() => navigateView('about')}>About</button>{session.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => navigateView('admin')}>Admin</button>}</nav><div className="account-area">{session.signedIn ? <><span className="account-name"><i />{session.username ?? 'Set username'}</span><button className="account-button" onClick={session.signOut}>Sign out</button></> : <button className="sign-in-button" onClick={session.signIn}>Sign in <span>↗</span></button>}</div></div></header>
    <main id="top" className="page-content">
      {view === 'about' ? <About demo={demo} onPlay={() => navigateView('picks')} /> : <>
      <section className="hero slate-hero"><div className="hero-lines" aria-hidden="true" /><div className="hero-content"><div className="eyebrow"><span className="live-dot" /> NHL REGULAR SEASON <span className="eyebrow-divider">/</span> {shownWeek?.season ?? '2026–27'}</div><div className="slate-summary"><div className="slate-date"><span className="slate-label">FRIDAY–SUNDAY · WEEKEND SLATE</span><h1>{shownWeek ? formatSlateDates(shownWeek.startDate) : 'NEXT WEEKEND'}</h1></div><div className="slate-stat"><strong>{games.length}</strong><span>GAMES</span></div><div className="slate-stat slate-deadline"><strong>{displayStatus === 'final' ? 'FINAL' : displayStatus === 'locked' ? 'LOCKED' : shownWeek?.lockAt ? formatTime(shownWeek.lockAt) : 'TBD'}</strong><span>{displayStatus === 'final' ? 'RESULTS' : 'ENTRY DEADLINE'}</span></div></div></div><div className="hero-number" aria-hidden="true">{String(games.length).padStart(2, '0')}</div></section>

      <div className="content-wrap">
        {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
        {loading ? <div className="loading-panel">Loading the weekend slate…</div> : !shownWeek || (!games.length && view !== 'admin') ? <div className="empty-state large"><span className="empty-icon">◇</span><h2>No regular-season games on this weekend</h2><p>The pool will appear when the next NHL regular-season weekend is scheduled.</p></div> : <>
          <div className="section-heading"><div><span className="section-kicker">{view === 'picks' ? '01 / MAKE YOUR CALL' : view === 'standings' ? '02 / THE LEADERBOARD' : view === 'season' ? '03 / THE LONG GAME' : '04 / CONTROL ROOM'}</span><h2>{view === 'picks' ? 'THE PICK SHEET' : view === 'standings' ? 'WEEKEND STANDINGS' : view === 'season' ? 'SEASON STANDINGS' : 'ADMIN DESK'}</h2></div><div className="heading-actions">{weeks.length > 1 && <select aria-label="Choose weekend" value={selectedWeek ?? ''} onChange={(event) => setSelectedWeek(event.target.value || null)}><option value="">Current weekend</option>{weeks.map((item) => <option key={item.start_date} value={item.start_date}>{item.start_date}</option>)}</select>}<span className={`status-pill ${displayStatus}`}><i /> {displayStatus === 'open' ? 'ENTRIES OPEN' : displayStatus === 'locked' ? 'PICKS LOCKED' : demo ? 'RESULTS PREVIEW' : 'FINAL RESULTS'}</span></div></div>

          {view === 'picks' && <div className="pick-layout"><div className="games-column">
            {!session.signedIn && open && <div className="inline-callout"><div><b>Get in on the action.</b><span>Sign in to make your picks for this weekend.</span></div><button onClick={session.signIn}>Sign in to play →</button></div>}
            {session.signedIn && !session.username && open && <div className="inline-callout"><div><b>Choose your public username.</b><span>Only this name appears on pool results.</span></div><div className="alias-form"><input aria-label="Public username" placeholder="Your username" value={alias} onChange={(event) => setAlias(event.target.value)} /><button disabled={alias.trim().length < 4} onClick={() => void changeAlias()}>Save</button></div></div>}
            {[0, 1, 2].map((offset) => { const date = addDays(shownWeek.startDate, offset); const dayGames = games.filter((game) => game.easternDate === date); return <section className="day-section" key={date}><div className="day-heading"><div><span className="day-index">0{offset + 1}</span><h3>{formatDay(date).split(',')[0].toUpperCase()}</h3><span className="day-date">{formatDay(date).split(',').slice(1).join(',').trim().toUpperCase()}</span></div><span className="day-count">{dayGames.length} {dayGames.length === 1 ? 'GAME' : 'GAMES'}</span></div>{dayGames.length ? dayGames.map((game) => <Matchup key={game.id} game={game} pick={draft.find((pick) => pick.gameId === game.id)} allPicks={draft} count={games.length} editable={!!session.signedIn && !!session.username && !!open} onPick={updatePick} />) : <div className="no-games">No games scheduled.</div>}</section> })}
            {picksUnlocked && session.signedIn && <section className="other-picks"><div className="day-heading"><div><span className="day-index">↗</span><h3>AROUND THE POOL</h3></div><span className="day-count">PICKS REVEALED</span></div>{demo ? <div className="pool-pick-row"><b>blue_line</b><span>Picked {games.length} games · top confidence: WPG</span></div> : publicPicks.length ? Object.entries(groupedPicks).map(([username, picks]) => <details key={username}><summary>{username}<small>{picks.length} PICKS</small></summary><div className="revealed-picks">{picks.map((pick) => { const game = games.find((item) => item.id === pick.game_id); return <span key={pick.game_id}>{game?.[pick.side].code ?? pick.side} <b>{pick.confidence}</b></span> })}</div></details>) : <p className="muted-note">No entries were submitted.</p>}</section>}
          </div><aside className="sidebar"><div className="board-card"><span className="card-kicker">YOUR ENTRY</span><div className="board-score"><strong>{pickedCount}<span>/{games.length}</span></strong><small>GAMES RANKED</small></div><div className="progress-track"><span style={{ width: `${games.length ? pickedCount / games.length * 100 : 0}%` }} /></div><div className="board-divider" /><div className="board-label"><b>AVAILABLE NUMBERS</b><small>{remaining.length} LEFT</small></div><div className="number-grid">{Array.from({ length: games.length }, (_, index) => games.length - index).map((number) => <span key={number} className={remaining.includes(number) ? '' : 'used'}>{number}</span>)}</div>{open ? <><button className="save-button" disabled={!session.signedIn || !session.username || !!errors.length || saving} onClick={() => void saveEntry()}>{saving ? 'Saving…' : entry ? 'Update my picks' : 'Submit my picks'} <span>→</span></button>{saveFeedback && <div className={`save-inline ${saveFeedback.kind}`}><b>{saveFeedback.kind === 'success' ? '✓ SAVED' : 'SAVE FAILED'}</b><span>{saveFeedback.text}</span></div>}{errors.length ? <p className="board-help">{errors[0]}</p> : !saveFeedback && <p className="board-help">All picks are ready. You can revise them until lock.</p>}</> : <div className="locked-note">{entry ? 'Your entry is locked in.' : 'Entries are closed.'}</div>}</div><div className="rules-card"><span className="card-kicker">HOW SCORING WORKS</span><p><b>{games.length}</b> on a winner? Earn <b>{games.length} points.</b><br />Miss the pick? Earn <b>0.</b></p><small>Each number can be used once. Highest weekend total takes the top spot.</small></div></aside></div>}

          {view === 'standings' && <div className="results-layout"><div className="results-main"><div className="results-intro"><span className="card-kicker">{displayStatus === 'final' ? demo ? 'SAMPLE RESULTS' : 'OFFICIAL RESULTS' : picksUnlocked ? 'PICKS REVEALED' : 'ENTRIES ARE ROLLING IN'}</span><h3>{displayStatus === 'final' ? 'THE FINAL HORN.' : picksUnlocked ? 'THE PICKS ARE IN.' : 'WHO’S ON THE BOARD?'}</h3><p>{displayStatus === 'final' ? 'Every result is in. See how your confidence picks stacked up.' : picksUnlocked ? 'Open a player’s entry to see their picks. Rankings arrive when every game is final or void.' : 'Submitted usernames appear here right away. Picks stay hidden until the entry deadline passes, and rankings arrive after the final game.'}</p></div>{displayStatus === 'final' && <StandingsList rows={visibleStandings} emptyText="No completed entries for this weekend." />}<EntrantsBoard usernames={visibleEntrants} games={games} picks={visiblePublicPicks} unlocked={picksUnlocked} canViewPicks={session.signedIn} /></div><aside className="results-aside"><span className="card-kicker">WEEKEND SNAPSHOT</span><strong>{games.filter((game) => game.state === 'final').length}<small>/{games.length}</small></strong><span>GAMES FINAL</span><div className="board-divider" /><p><b>{visibleEntrants.length}</b> {visibleEntrants.length === 1 ? 'player has' : 'players have'} submitted an entry.</p><p>All times and weekend dates are shown in Eastern time.</p></aside></div>}

          {view === 'season' && <div className="results-layout"><div className="results-main"><div className="results-intro"><span className="card-kicker">{demo ? 'SAMPLE' : shownWeek.season} REGULAR SEASON</span><h3>EVERY WEEKEND COUNTS.</h3><p>Points from finalized regular-season weekends add up here.</p></div><StandingsList rows={visibleSeason} emptyText="The season table starts after the first completed weekend." /></div><aside className="results-aside"><span className="card-kicker">THE RACE</span><strong>{shownWeek.season}</strong><span>REGULAR SEASON</span><div className="board-divider" /><p>Tied totals share the same rank.</p></aside></div>}

          {view === 'admin' && session.isAdmin && <div className="admin-panel"><div className="results-intro"><span className="card-kicker">PRIVATE ADMIN CONTROLS</span><h3>KEEP THE SLATE ACCURATE.</h3><p>Resync before lock, correct a final score or void a game, then recalculate results.</p></div><div className="admin-actions"><button onClick={() => void adminAction('sync')}>Resync schedule</button><button onClick={() => void adminAction('finalize')}>Recalculate final standings</button></div><div className="admin-form"><label>Game<select value={adminGameId} onChange={(event) => setAdminGameId(event.target.value)}><option value="">Choose game</option>{games.map((game) => <option key={game.id} value={game.id}>{game.away.code} at {game.home.code} · {formatDay(game.easternDate)}</option>)}</select></label><label>Result<select value={adminState} onChange={(event) => setAdminState(event.target.value as 'final' | 'void')}><option value="final">Final</option><option value="void">Void</option></select></label><label>Away score<input type="number" min="0" value={adminAway} onChange={(event) => setAdminAway(event.target.value)} disabled={adminState === 'void'} /></label><label>Home score<input type="number" min="0" value={adminHome} onChange={(event) => setAdminHome(event.target.value)} disabled={adminState === 'void'} /></label><button disabled={!adminGameId || saving} onClick={() => void adminAction('game', { gameId: Number(adminGameId), state: adminState, awayScore: Number(adminAway), homeScore: Number(adminHome) })}>Save result</button></div></div>}
          {view === 'admin' && session.isAdmin && <div className="admin-panel admin-schedule">
            <div className="results-intro"><span className="card-kicker">SCHEDULE FALLBACK</span><h3>MANUAL MATCHUP.</h3><p>Add a missing NHL game before lock if the feed is unavailable. The game ID must match the NHL schedule.</p></div>
            <div className="admin-form">
              <label>Weekend Friday<input type="date" value={shownWeek.startDate} onChange={(event) => setSelectedWeek(event.target.value)} /></label>
              <label>NHL game ID<input type="number" value={newGameId} onChange={(event) => setNewGameId(event.target.value)} /></label>
              <label>Start, your local time<input type="datetime-local" value={newStartUtc} onChange={(event) => setNewStartUtc(event.target.value)} /></label>
              <label>Away code<input value={newAwayCode} onChange={(event) => setNewAwayCode(event.target.value)} placeholder="WPG" /></label>
              <label>Away name<input value={newAwayName} onChange={(event) => setNewAwayName(event.target.value)} placeholder="Winnipeg Jets" /></label>
              <label>Home code<input value={newHomeCode} onChange={(event) => setNewHomeCode(event.target.value)} placeholder="TOR" /></label>
              <label>Home name<input value={newHomeName} onChange={(event) => setNewHomeName(event.target.value)} placeholder="Toronto Maple Leafs" /></label>
              <button disabled={saving || !newGameId || !newStartUtc || !newAwayCode || !newAwayName || !newHomeCode || !newHomeName || displayStatus !== 'open'} onClick={() => void adminAction('game', { gameId: Number(newGameId), startUtc: new Date(newStartUtc).toISOString(), awayCode: newAwayCode, awayName: newAwayName, homeCode: newHomeCode, homeName: newHomeName })}>Add matchup</button>
              <button className="remove-button" disabled={saving || !adminGameId || displayStatus !== 'open'} onClick={() => void adminAction('remove-game', { gameId: Number(adminGameId) })}>Remove selected game</button>
            </div>
          </div>}
        </>}
      </div>
      </>}
    </main>
    <footer className="site-footer"><span>WEEKEND HOCKEY POOL</span><span>A SIMPLE HOCKEY POOL</span><span>NHL schedule and scores · Eastern time</span><span className="footer-disclaimer">For fun only · No real money involved · Not affiliated with or endorsed by the NHL</span></footer>
    {saveToastVisible && saveFeedback && <div className={`save-toast ${saveFeedback.kind}`} role={saveFeedback.kind === 'error' ? 'alert' : 'status'} aria-live={saveFeedback.kind === 'error' ? 'assertive' : 'polite'}>
      <span className="save-toast-icon" aria-hidden="true">{saveFeedback.kind === 'success' ? '✓' : '!'}</span>
      <div><strong>{saveFeedback.kind === 'success' ? 'PICKS SAVED' : 'COULD NOT SAVE'}</strong><p>{saveFeedback.text}</p></div>
      <button type="button" aria-label="Dismiss save notification" onClick={() => setSaveToastVisible(false)}>×</button>
    </div>}
  </div>
}

export default App
