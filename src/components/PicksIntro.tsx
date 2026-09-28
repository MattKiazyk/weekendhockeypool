import { useState } from 'react'

const dismissalKey = 'hockey-pool-intro-dismissed'

export default function PicksIntro({ active, onAbout }: { active: boolean; onAbout: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissalKey) === 'true'
    } catch {
      return false
    }
  })

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(dismissalKey, 'true')
    } catch {
      // Keep dismissal in memory when browser storage is unavailable.
    }
  }

  if (!active || dismissed) return null

  return (
    <section className="picks-intro" aria-labelledby="picks-intro-title">
      <div className="picks-intro-inner">
        <div className="picks-intro-heading">
          <div>
            <span className="section-kicker">NEW TO THE POOL?</span>
            <h2 id="picks-intro-title">HOW IT WORKS</h2>
          </div>
          <button type="button" className="picks-intro-dismiss" onClick={dismiss}>
            Got it <span aria-hidden="true">✓</span>
          </button>
        </div>
        <ol className="picks-intro-steps">
          <li className="picks-intro-pick">
            <div className="picks-intro-visual" aria-hidden="true">
              <svg viewBox="0 0 100 80" fill="none">
                <path
                  d="M57 19 77 12 96 19 93 46 77 59 61 46Z"
                  fill="#1e3651"
                  stroke="#6684a9"
                  strokeWidth="2"
                />
                <path
                  d="M6 16 32 6 58 16 54 52 32 71 10 52Z"
                  fill="#226bd4"
                  stroke="#92c6ff"
                  strokeWidth="2"
                />
                <path
                  d="m20 36 9 9 17-21"
                  stroke="white"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h3>
                <span>01</span> Pick a winner
              </h3>
              <p>One team per game. Make a pick for every game on the weekend sheet.</p>
            </div>
          </li>
          <li className="picks-intro-rank">
            <div className="picks-intro-visual picks-intro-numbers" aria-hidden="true">
              <span>1</span>
              <span>2</span>
              <span>3</span>
            </div>
            <div>
              <h3>
                <span>02</span> Rank each game
              </h3>
              <p>Use 1 through the game count once each. Higher = more confident.</p>
            </div>
          </li>
          <li className="picks-intro-score">
            <div className="picks-intro-visual picks-intro-points" aria-hidden="true">
              <span>✓</span>
              <strong>+3</strong>
              <small>POINTS</small>
            </div>
            <div>
              <h3>
                <span>03</span> Get the most points
              </h3>
              <p>A correct pick on a game earns its points. A miss earns 0.</p>
            </div>
          </li>
        </ol>
        <div className="picks-intro-footer">
          <p>
            <span aria-hidden="true">◷</span>{' '}
            <strong>Sign in &amp; save before the first game.</strong> Edit until puck drop.
          </p>
          <button type="button" className="picks-intro-rules" onClick={onAbout}>
            Read the full rules <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  )
}
