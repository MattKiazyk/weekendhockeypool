import type { PoolSession } from '../lib/session'
import { views, type View } from '../lib/views'
import ViewLink from './ViewLink'

export default function SiteHeader({
  session,
  view,
  onNavigate,
}: {
  session: PoolSession
  view: View
  onNavigate: (view: View) => void
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <ViewLink view="picks" className="brand" onNavigate={onNavigate}>
          <img
            className="brand-mark"
            src="/logo-concepts/04-center-ice-roundel.png"
            alt=""
            aria-hidden="true"
          />
          <span>
            <b>
              WEEKLY <span className="brand-blue">POOLS</span>
            </b>
          </span>
        </ViewLink>
        <nav className="main-nav" aria-label="Main navigation">
          {views
            .filter(
              (item) =>
                item.id !== 'policy' &&
                item.id !== 'terms' &&
                (item.id !== 'admin' || session.isAdmin) &&
                (item.id !== 'email-settings' || session.signedIn),
            )
            .map((item) => (
              <ViewLink
                key={item.id}
                view={item.id}
                className={view === item.id ? 'active' : ''}
                current={view === item.id}
                onNavigate={onNavigate}
              >
                {item.label}
              </ViewLink>
            ))}
        </nav>
        <div className="account-area">
          {session.signedIn ? (
            <>
              <span className="account-name">
                <i />
                {session.username ?? 'Set username'}
              </span>
              <button className="account-button" onClick={session.signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="sign-in-button" onClick={session.signIn}>
              Sign in <span>↗</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
