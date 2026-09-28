import { useEffect, useState } from 'react'
import About from './About'
import AdminPanel from './components/AdminPanel'
import LeagueTabs from './components/LeagueTabs'
import PickSheet from './components/PickSheet'
import PicksIntro from './components/PicksIntro'
import { SeasonResults, WeekendResults } from './components/Results'
import SaveToast, { type SaveFeedback } from './components/SaveToast'
import SiteHeader from './components/SiteHeader'
import WeekHero from './components/WeekHero'
import WeekendNav from './components/WeekendNav'
import { usePool } from './hooks/usePool'
import type { PreviewStage } from './lib/demo'
import { isLeague } from './lib/leagues'
import {
  entryOpensAt,
  hasEntryDeadlinePassed,
  isEntryOpen,
  seasonFor,
  updatePick,
  validatePicks,
  weekendStartAt,
  type Pick,
  type LeagueId,
  type Weekend,
} from './lib/pool'
import type { PoolSession } from './lib/session'
import { viewFromHash, views, type View } from './lib/views'

export default function App({ session, demo }: { session: PoolSession; demo: boolean }) {
  const [view, setView] = useState<View>(viewFromHash)
  const [league, setLeague] = useState<LeagueId>(() => {
    const selected = new URLSearchParams(window.location.search).get('league')
    return isLeague(selected) ? selected : 'nhl'
  })
  const [seasonScope, setSeasonScope] = useState<'league' | 'all'>('league')
  const [stage, setStage] = useState<PreviewStage>('open')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null)
  const [saveToastVisible, setSaveToastVisible] = useState(false)
  const pool = usePool(session, league, demo, stage, view === 'standings')
  const {
    week,
    weeks,
    entry,
    draft,
    standings,
    seasonStandings,
    combinedStandings,
    entrants,
    publicPicks,
    loading,
    error,
    setError,
    selectedWeek,
    setSelectedWeek,
  } = pool

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash())
    const onPopState = () => {
      const selected = new URLSearchParams(window.location.search).get('league')
      const nextLeague = isLeague(selected) ? selected : 'nhl'
      if (nextLeague !== league) {
        setLeague(nextLeague)
        setSelectedWeek(null)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onPopState)
    }
  }, [league, setSelectedWeek])

  useEffect(() => {
    if (!saveToastVisible) return
    const timer = window.setTimeout(() => setSaveToastVisible(false), 8000)
    return () => window.clearTimeout(timer)
  }, [saveFeedback, saveToastVisible])

  useEffect(() => {
    setSaveFeedback(null)
    setSaveToastVisible(false)
    setMessage('')
  }, [league, selectedWeek, session.userId])

  const currentWeekend = weekendStartAt(pool.clock)
  const currentSeason = seasonFor(currentWeekend)
  let shownWeek: Weekend | null = view === 'season' ? null : week
  if (!shownWeek && (view === 'season' || (view === 'admin' && session.isAdmin))) {
    const startDate = view === 'season' ? currentWeekend : (selectedWeek ?? currentWeekend)
    shownWeek = {
      league,
      startDate,
      season: seasonFor(startDate),
      opensAt: entryOpensAt(startDate),
      lockAt: null,
      status: 'open',
      finalizedAt: null,
      games: [],
    }
  }
  const upcoming =
    !!shownWeek &&
    (demo
      ? stage === 'upcoming'
      : shownWeek.status === 'open' && pool.clock < Date.parse(shownWeek.opensAt))
  const open = !!shownWeek && (demo ? stage === 'open' : isEntryOpen(shownWeek, pool.clock))
  const displayStatus = upcoming
    ? 'upcoming'
    : shownWeek?.status === 'open' && shownWeek.lockAt && !open
      ? 'locked'
      : (shownWeek?.status ?? 'open')
  const picksUnlocked =
    !!shownWeek &&
    (demo ? stage === 'locked' || stage === 'final' : hasEntryDeadlinePassed(shownWeek, pool.clock))
  const heading = views.find((item) => item.id === view)!

  function navigateView(next: View) {
    setView(next)
    window.location.hash = next
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function changeLeague(next: LeagueId) {
    if (next === league) return
    const url = new URL(window.location.href)
    if (next === 'nhl') url.searchParams.delete('league')
    else url.searchParams.set('league', next)
    window.history.pushState(null, '', url)
    setSelectedWeek(null)
    setSeasonScope('league')
    setLeague(next)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function changePick(next: Pick) {
    setMessage('')
    setSaveFeedback(null)
    setSaveToastVisible(false)
    pool.setDraft((previous) => updatePick(previous, next))
  }

  async function saveEntry() {
    if (!shownWeek || !open || !session.signedIn || validatePicks(draft, shownWeek.games).length)
      return
    setSaving(true)
    setError('')
    setMessage('')
    setSaveFeedback(null)
    setSaveToastVisible(false)
    try {
      await pool.saveEntry()
      setSaveFeedback({
        kind: 'success',
        text: 'Your picks are saved. You can update them until the deadline.',
      })
    } catch (cause) {
      setSaveFeedback({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'Could not save picks',
      })
    } finally {
      setSaving(false)
      setSaveToastVisible(true)
    }
  }

  async function adminAction(path: string, payload: Record<string, unknown> = {}) {
    if (!shownWeek) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await pool.adminAction(shownWeek.startDate, path, payload)
      setMessage('Admin change saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Admin change failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="site-shell">
      {demo && (
        <div className="demo-bar">
          <span>
            <b>LOCAL DESIGN PREVIEW</b> ·{' '}
            {league === 'nhl' ? 'Sample NHL schedule' : 'PWHL coming-soon preview'} · Picks stay in
            this browser
          </span>
          <div className="demo-stages">
            <span>View state</span>
            {(['upcoming', 'open', 'locked', 'final'] as const).map((item) => (
              <button
                key={item}
                className={stage === item ? 'active' : ''}
                onClick={() => setStage(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
      <SiteHeader session={session} view={view} onNavigate={navigateView} />
      <LeagueTabs league={league} onChange={changeLeague} />
      <main id="top" className="page-content">
        <PicksIntro active={view === 'picks'} onAbout={() => navigateView('about')} />
        {view === 'about' ? (
          <About demo={demo} onPlay={() => navigateView('picks')} />
        ) : (
          <>
            <WeekHero
              week={
                view === 'season' ||
                (league === 'pwhl' && !shownWeek?.games.length && !weeks.length)
                  ? null
                  : shownWeek
              }
              league={league}
              status={displayStatus}
              season={view === 'season' ? currentSeason : undefined}
              seasonOnly={view === 'season'}
            />
            <div className="content-wrap">
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              {message && (
                <div className="notice success" role="status">
                  {message}
                </div>
              )}
              {!loading && (view === 'picks' || view === 'standings') && (
                <WeekendNav
                  weeks={weeks}
                  activeStart={selectedWeek ?? week?.startDate ?? currentWeekend}
                  onChange={(start) => setSelectedWeek(start === currentWeekend ? null : start)}
                />
              )}
              {loading ? (
                <div className="loading-panel">Loading the weekend slate…</div>
              ) : !shownWeek ||
                (!shownWeek.games.length && view !== 'admin' && view !== 'season') ? (
                <div className="empty-state large">
                  <span className="empty-icon">◇</span>
                  <h2>
                    {league === 'pwhl' && !weeks.length
                      ? 'PWHL IS COMING THIS SEASON'
                      : 'No regular-season games on this weekend'}
                  </h2>
                  <p>
                    {league === 'pwhl' && !weeks.length
                      ? 'PWHL picks will open when the first regular-season weekend is scheduled.'
                      : `Try another ${league.toUpperCase()} weekend when games are scheduled.`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="section-kicker">{heading.kicker}</span>
                      <h2>{heading.title}</h2>
                    </div>
                    <div className="heading-actions">
                      {!!shownWeek.games.length && (
                        <span className={`status-pill ${displayStatus}`}>
                          <i />{' '}
                          {displayStatus === 'open'
                            ? 'ENTRIES OPEN'
                            : displayStatus === 'upcoming'
                              ? 'OPENS MON 8 AM ET'
                              : displayStatus === 'locked'
                                ? 'PICKS LOCKED'
                                : demo
                                  ? 'RESULTS PREVIEW'
                                  : 'FINAL RESULTS'}
                        </span>
                      )}
                    </div>
                  </div>
                  {view === 'picks' && (
                    <PickSheet
                      week={shownWeek}
                      session={session}
                      draft={draft}
                      entry={entry}
                      open={open}
                      upcoming={upcoming}
                      picksUnlocked={picksUnlocked}
                      entrants={entrants}
                      publicPicks={publicPicks}
                      saving={saving}
                      saveFeedback={saveFeedback}
                      onPick={changePick}
                      onSave={saveEntry}
                      onMessage={setMessage}
                      onError={setError}
                    />
                  )}
                  {view === 'standings' && (
                    <WeekendResults
                      week={shownWeek}
                      demo={demo}
                      displayStatus={displayStatus}
                      picksUnlocked={picksUnlocked}
                      signedIn={session.signedIn}
                      standings={standings}
                      entrants={entrants}
                      publicPicks={publicPicks}
                    />
                  )}
                  {view === 'season' && (
                    <SeasonResults
                      season={currentSeason}
                      league={league}
                      scope={seasonScope}
                      onScopeChange={setSeasonScope}
                      demo={demo}
                      standings={seasonStandings}
                      combinedStandings={combinedStandings}
                    />
                  )}
                  {view === 'admin' && session.isAdmin && (
                    <AdminPanel
                      week={shownWeek}
                      saving={saving}
                      onAction={adminAction}
                      onSelectWeek={setSelectedWeek}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>WEEKEND POOLS</span>
        <span>WEEKEND CONFIDENCE POOLS</span>
        <span>NHL and PWHL schedules and scores · Eastern time</span>
        <span className="footer-disclaimer">
          For fun only · No real money involved · Not affiliated with or endorsed by the NHL or PWHL
        </span>
        <span className="footer-disclaimer">
          PWHL statistics provided by the Professional Women’s Hockey League ·{' '}
          <a href="http://leaguestat.com" target="_blank" rel="noreferrer">
            Powered by HockeyTech.com
          </a>
        </span>
      </footer>
      {saveToastVisible && saveFeedback && (
        <SaveToast feedback={saveFeedback} onDismiss={() => setSaveToastVisible(false)} />
      )}
    </div>
  )
}
