import type { View } from '../lib/views'
import ViewLink from './ViewLink'

export default function SiteFooter({
  view,
  onNavigate,
}: {
  view: View
  onNavigate: (view: View) => void
}) {
  return (
    <footer className="site-footer">
      <span>WEEKLY POOLS</span>
      <span>WEEKLY CONFIDENCE POOLS</span>
      <span>NHL, PWHL, and NFL schedules and scores · Eastern time</span>
      <nav className="footer-links" aria-label="Legal information">
        <ViewLink view="policy" current={view === 'policy'} onNavigate={onNavigate}>
          Privacy Policy
        </ViewLink>
        <ViewLink view="terms" current={view === 'terms'} onNavigate={onNavigate}>
          Terms of Service
        </ViewLink>
      </nav>
      <span className="footer-disclaimer">
        For fun only · No real money involved · Not affiliated with or endorsed by the NHL, PWHL, or
        NFL
      </span>
      <span className="footer-disclaimer">
        PWHL statistics provided by the Professional Women’s Hockey League ·{' '}
        <a href="http://leaguestat.com" target="_blank" rel="noreferrer">
          Powered by HockeyTech.com
        </a>
      </span>
      <span className="footer-disclaimer">NFL schedule and scores provided by ESPN.</span>
    </footer>
  )
}
