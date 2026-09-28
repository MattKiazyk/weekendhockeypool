import type { PoolSession } from '../lib/session'
import { views, type View } from '../lib/views'

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
        <a
          href="#picks"
          className="brand"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('picks')
          }}
        >
          <img
            className="brand-mark"
            src="/logo-concepts/04-center-ice-roundel.png"
            alt=""
            aria-hidden="true"
          />
          <span>
            <b>
              WEEKEND <span className="brand-blue">POOLS</span>
            </b>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {views
            .filter((item) => item.id !== 'admin' || session.isAdmin)
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
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
