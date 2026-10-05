import type { PoolSession } from '../lib/session'
import { viewUrl, views, type View } from '../lib/views'
import type { MouseEvent } from 'react'

export default function SiteHeader({
  session,
  view,
  onNavigate,
}: {
  session: PoolSession
  view: View
  onNavigate: (view: View) => void
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>, next: View) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onNavigate(next)
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <a href={viewUrl('picks')} className="brand" onClick={(event) => navigate(event, 'picks')}>
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
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {views
            .filter(
              (item) =>
                (item.id !== 'admin' || session.isAdmin) &&
                (item.id !== 'email-settings' || session.signedIn),
            )
            .map((item) => (
              <a
                key={item.id}
                href={viewUrl(item.id)}
                className={view === item.id ? 'active' : ''}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={(event) => navigate(event, item.id)}
              >
                {item.label}
              </a>
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
