import { useEffect, useState } from 'react'
import About from './About'
import AdminPanel from './components/AdminPanel'
import PickSheet from './components/PickSheet'
import PicksIntro from './components/PicksIntro'
import { SeasonResults, WeekendResults } from './components/Results'
import SaveToast, { type SaveFeedback } from './components/SaveToast'
import SiteHeader from './components/SiteHeader'
import WeekHero from './components/WeekHero'
import { usePool } from './hooks/usePool'
import {
  hasEntryDeadlinePassed,
  isEntryOpen,
  seasonFor,
  updatePick,
  validatePicks,
  weekendStartAt,
  type Pick,
  type Weekend,
  type WeekendStatus,
} from './lib/pool'
import type { PoolSession } from './lib/session'
import { viewFromHash, views, type View } from './lib/views'

export default function App({ session, demo }: { session: PoolSession; demo: boolean }) {
  const [view, setView] = useState<View>(viewFromHash)
  const [stage, setStage] = useState<WeekendStatus>('open')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null)
  const [saveToastVisible, setSaveToastVisible] = useState(false)
  const pool = usePool(session, demo, stage, view === 'standings')
  const {
    week,
    weeks,
    entry,
    draft,
    standings,
    seasonStandings,
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
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!saveToastVisible) return
    const timer = window.setTimeout(() => setSaveToastVisible(false), 8000)
    return () => window.clearTimeout(timer)
  }, [saveFeedback, saveToastVisible])

  useEffect(() => {
    setSaveFeedback(null)
    setSaveToastVisible(false)
    setMessage('')
  }, [selectedWeek, session.userId])

  let shownWeek: Weekend | null = week
  if (!shownWeek && view === 'admin' && session.isAdmin) {
    const startDate = selectedWeek ?? weekendStartAt(Date.now())
    shownWeek = {
      startDate,
      season: seasonFor(startDate),
      lockAt: null,
      status: 'open',
      finalizedAt: null,
      games: [],
    }
  }
  const open =
    !!shownWeek && (demo ? shownWeek.status === 'open' : isEntryOpen(shownWeek, pool.clock))
  const displayStatus =
    shownWeek?.status === 'open' && shownWeek.lockAt && !open
      ? 'locked'
      : (shownWeek?.status ?? 'open')
  const picksUnlocked =
    !!shownWeek &&
    (demo ? shownWeek.status !== 'open' : hasEntryDeadlinePassed(shownWeek, pool.clock))
  const heading = views.find((item) => item.id === view)!

  function navigateView(next: View) {
    setView(next)
    window.location.hash = next
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
            <b>LOCAL DESIGN PREVIEW</b> · Sample NHL schedule · Picks stay in this browser
          </span>
          <div className="demo-stages">
            <span>View state</span>
            {(['open', 'locked', 'final'] as const).map((item) => (
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
      <main id="top" className="page-content">
        <PicksIntro active={view === 'picks'} onAbout={() => navigateView('about')} />
        {view === 'about' ? (
          <About demo={demo} onPlay={() => navigateView('picks')} />
        ) : (
          <>
            <WeekHero week={shownWeek} status={displayStatus} />
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
              {loading ? (
                <div className="loading-panel">Loading the weekend slate…</div>
              ) : !shownWeek || (!shownWeek.games.length && view !== 'admin') ? (
                <div className="empty-state large">
                  <span className="empty-icon">◇</span>
                  <h2>No regular-season games on this weekend</h2>
                  <p>The pool will appear when the next NHL regular-season weekend is scheduled.</p>
                </div>
              ) : (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="section-kicker">{heading.kicker}</span>
                      <h2>{heading.title}</h2>
                    </div>
                    <div className="heading-actions">
                      {weeks.length > 1 && (
                        <select
                          aria-label="Choose weekend"
                          value={selectedWeek ?? ''}
                          onChange={(event) => setSelectedWeek(event.target.value || null)}
                        >
                          <option value="">Current weekend</option>
                          {weeks.map((item) => (
                            <option key={item.start_date} value={item.start_date}>
                              {item.start_date}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className={`status-pill ${displayStatus}`}>
                        <i />{' '}
                        {displayStatus === 'open'
                          ? 'ENTRIES OPEN'
                          : displayStatus === 'locked'
                            ? 'PICKS LOCKED'
                            : demo
                              ? 'RESULTS PREVIEW'
                              : 'FINAL RESULTS'}
                      </span>
                    </div>
                  </div>
                  {view === 'picks' && (
                    <PickSheet
                      week={shownWeek}
                      session={session}
                      draft={draft}
                      entry={entry}
                      open={open}
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
                    <SeasonResults week={shownWeek} demo={demo} standings={seasonStandings} />
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
        <span>WEEKEND HOCKEY POOL</span>
        <span>A SIMPLE HOCKEY POOL</span>
        <span>NHL schedule and scores · Eastern time</span>
        <span className="footer-disclaimer">
          For fun only · No real money involved · Not affiliated with or endorsed by the NHL
        </span>
      </footer>
      {saveToastVisible && saveFeedback && (
        <SaveToast feedback={saveFeedback} onDismiss={() => setSaveToastVisible(false)} />
      )}
    </div>
  )
}
