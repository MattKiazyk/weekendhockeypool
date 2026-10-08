type AboutProps = {
  demo: boolean
  onPlay: () => void
}

const steps = [
  {
    number: '01',
    title: 'Pick one winner',
    image: '/about-pick.svg',
    alt: 'Illustration of an away team selected over a home team',
    text: 'Choose NHL, PWHL, or NFL. Hockey sheets cover Friday through Sunday; NFL sheets follow the official regular-season week. Pick a winner for every game.',
  },
  {
    number: '02',
    title: 'Rank your confidence',
    image: '/about-rank.svg',
    alt: 'Illustration of unique confidence numbers with 18 highlighted',
    text: 'If there are 18 games, use each number from 18 down to 1 exactly once. Put the biggest number on the winner you feel best about.',
  },
  {
    number: '03',
    title: 'Watch the board',
    image: '/about-score.svg',
    alt: 'Illustration of a correct pick earning points on a leaderboard',
    text: 'A correct pick earns its confidence number. A miss earns zero. Each league has its own standings, and the combined season table adds points from whichever leagues you enter.',
  },
]

function About({ demo, onPlay }: AboutProps) {
  return (
    <>
      <section className="about-hero">
        <div className="about-hero-lines" aria-hidden="true" />
        <div className="about-hero-inner">
          <span className="eyebrow">
            <span className="live-dot" /> THE PLAYBOOK <span className="eyebrow-divider">/</span>{' '}
            WEEKLY POOLS
          </span>
          <h1>
            MAKE YOUR <em>CALL.</em>
          </h1>
          <p>
            Join NHL, PWHL, NFL, or any mix. You can make one entry per league each week, and you’re
            free to skip any league or week. It’s all just for fun.
          </p>
          <button type="button" className="about-cta" onClick={onPlay}>
            See this week’s games <span aria-hidden="true">↗</span>
          </button>
          <div className="about-hero-facts">
            <span>
              <strong>WEEKLY</strong>
              <small>THE SLATE</small>
            </span>
            <span>
              <strong>1–N</strong>
              <small>UNIQUE NUMBERS</small>
            </span>
            <span>
              <strong>$0</strong>
              <small>JUST FOR FUN</small>
            </span>
          </div>
        </div>
        <div className="about-hero-rink" aria-hidden="true">
          <div className="about-rink-ring ring-one" />
          <div className="about-rink-ring ring-two" />
          <div className="about-rink-center">WP</div>
        </div>
      </section>

      <div className="about-wrap">
        <section className="about-section" aria-labelledby="about-steps-title">
          <div className="about-section-heading">
            <span className="section-kicker">01 / THE THREE-STEP PLAY</span>
            <h2 id="about-steps-title">HOW TO PLAY</h2>
            <p>No brackets or complicated scoring. Just pick, rank, and follow the games.</p>
          </div>
          <div className="about-steps">
            {steps.map((step) => (
              <article className="about-step" key={step.number}>
                <img src={step.image} alt={step.alt} loading="lazy" />
                <div className="about-step-copy">
                  <span>{step.number} / STEP</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="about-example" aria-labelledby="about-example-title">
          <div>
            <span className="section-kicker">02 / THE POINTS</span>
            <h2 id="about-example-title">YOUR NUMBER IS YOUR SCORE.</h2>
            <p>
              Put 18 on a game and pick the winner? You earn 18 points. If that team loses, you earn
              zero for that game.
            </p>
          </div>
          <div className="about-point-examples">
            <div className="about-point-row">
              <span className="about-point-number">18</span>
              <span>Correct pick</span>
              <strong>+18</strong>
            </div>
            <div className="about-point-row miss">
              <span className="about-point-number">18</span>
              <span>Incorrect pick</span>
              <strong>+0</strong>
            </div>
          </div>
        </section>

        <section className="about-details" aria-labelledby="about-details-title">
          <div className="about-section-heading">
            <span className="section-kicker">03 / THE FINE PRINT</span>
            <h2 id="about-details-title">GOOD TO KNOW</h2>
          </div>
          <div className="about-detail-grid">
            <article>
              <span className="about-detail-icon" aria-hidden="true">
                ◷
              </span>
              <h3>When can I enter?</h3>
              <p>
                Hockey matchups are visible early, with picks opening Monday at 8 a.m. Eastern. NFL
                weeks open Tuesday at 8 a.m. Eastern. Each league locks at its first scheduled game,
                and you can save changes until then.
              </p>
            </article>
            <article>
              <span className="about-detail-icon" aria-hidden="true">
                ▤
              </span>
              <h3>Can I see other picks?</h3>
              <p>
                Only after the entry deadline passes can signed-in players see everyone’s picks.
                Before then, only submitted usernames are visible. Guests can browse the schedule
                and finished standings.
              </p>
            </article>
            <article>
              <span className="about-detail-icon" aria-hidden="true">
                ◇
              </span>
              <h3>What if a game is postponed?</h3>
              <p>
                A postponed or cancelled game is void for everyone. NFL ties and games moved to a
                different NFL week are also void. The remaining picks keep their numbers.
              </p>
            </article>
            <article>
              <span className="about-detail-icon" aria-hidden="true">
                ≡
              </span>
              <h3>When are ranks final?</h3>
              <p>
                After every game is final or void. Equal point totals share a rank, and points from
                finalized weeks add to that league’s season standings and the combined total.
              </p>
            </article>
          </div>
        </section>

        <section className="about-privacy" aria-labelledby="about-privacy-title">
          <div className="about-privacy-mark" aria-hidden="true">
            <span>✓</span>
          </div>
          <div>
            <span className="section-kicker">04 / YOUR ACCOUNT</span>
            <h2 id="about-privacy-title">A QUICK PRIVACY NOTE</h2>
            <p>
              Clerk handles sign-in so only you can submit or edit your entry. The pool keeps your
              Clerk account ID, public username, picks, and submission times to run the standings.
              It also keeps your primary email address, verification status, and preferences
              privately for account and pool emails. Your password is handled by Clerk.
            </p>
            <p>
              Your username appears in the entries list as soon as you submit and later on results.
              Your picks stay hidden until the entry deadline passes, when signed-in players can
              view them. {demo && 'In this local preview, sample picks are saved in this browser.'}
            </p>
          </div>
        </section>

        <div className="about-bottom-cta">
          <div>
            <span className="section-kicker">READY FOR THE FIRST GAME?</span>
            <h2>MAKE YOUR PICKS.</h2>
          </div>
          <button type="button" onClick={onPlay}>
            Open the pick sheet <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </>
  )
}

export default About
