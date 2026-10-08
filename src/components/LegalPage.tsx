import { views, type View } from '../lib/views'
import ViewLink from './ViewLink'

type LegalPageProps = {
  view: 'privacy' | 'terms'
  onNavigate: (view: View) => void
}

function PrivacyPolicy({ onNavigate }: Pick<LegalPageProps, 'onNavigate'>) {
  return (
    <>
      <p className="legal-intro">
        Weekly Pools runs free sports confidence pools at weeklypools.ca. This policy explains what
        information we use, what other players can see, and the choices you have.
      </p>
      <section>
        <h2>Information we collect</h2>
        <p>
          We keep your Clerk account ID, public username, pool entries, team selections, confidence
          numbers, submission times, and results. For account emails, we also keep your primary
          email address, verification status, email preferences, and delivery records, including
          reminder counts. If you contact us, we receive the information you send.
        </p>
        <p>
          Clerk handles sign-in and account credentials; Weekly Pools does not store your password.
          Our hosting and authentication providers may process technical information such as your IP
          address, browser details, and session data to deliver and secure the service. Approved
          native API access also stores account approvals and device-key records.
        </p>
      </section>
      <section>
        <h2>How we use information</h2>
        <p>
          We use this information to authenticate your account, save your picks, calculate
          standings, send account and pool emails, answer requests, and protect the service from
          abuse. We do not sell your personal information.
        </p>
      </section>
      <section>
        <h2>What other players can see</h2>
        <p>
          Your username is public in entry lists and standings. Your team selections and confidence
          numbers are hidden from other players until that pool week’s entry deadline passes; after
          that, signed-in players can view them. Standings, including usernames and scores, may also
          appear in recap emails. Your email address is private and is not included in public pool
          responses.
        </p>
      </section>
      <section>
        <h2>Email choices</h2>
        <p>
          New verified accounts may receive a one-time welcome email. League pick reminders and
          recaps default on; you can turn each type off for each league in{' '}
          <ViewLink view="email-settings" onNavigate={onNavigate}>
            Email Settings
          </ViewLink>{' '}
          and save your changes. The welcome email is separate from those switches. Automated emails
          come from an unmonitored address; contact us below for help.
        </p>
      </section>
      <section>
        <h2>Service providers and browser storage</h2>
        <p>
          We use Clerk for authentication and Cloudflare for hosting, database storage, security,
          and email delivery. These providers process information needed for those services and may
          process it outside Canada. See{' '}
          <a href="https://clerk.com/legal/privacy">Clerk’s privacy information</a> and{' '}
          <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s Privacy Policy</a>.
          Google Fonts supplies our typefaces and receives technical information when your browser
          requests them; see{' '}
          <a href="https://policies.google.com/privacy">Google’s Privacy Policy</a>.
        </p>
        <p>
          Clerk uses cookies and related browser storage for sign-in. We use local browser storage
          to remember dismissal of the Picks guide; development previews also store sample picks and
          settings locally. You can clear or block browser storage, though sign-in or saved
          preferences may stop working.
        </p>
      </section>
      <section>
        <h2>Site analytics</h2>
        <p>
          We use Google Analytics to understand site traffic and improve the service. It uses
          cookies and processes information about pages visited, site interactions, browser and
          device details, and approximate location. Google also processes your IP address when
          handling analytics requests. See{' '}
          <a href="https://support.google.com/analytics/answer/6004245">
            Google’s analytics privacy information
          </a>
          . You can block analytics cookies in your browser or use Google’s{' '}
          <a href="https://tools.google.com/dlpage/gaoptout">Analytics opt-out browser add-on</a>.
        </p>
      </section>
      <section>
        <h2>Retention and security</h2>
        <p>
          Pool entries and results are retained to maintain weekly and season history. Account,
          email, and security records are retained as needed to operate the service, prevent
          duplicate emails, handle requests, and meet applicable obligations. Account deletion in
          Clerk removes the active email address from our email account record and stops future pool
          emails; it does not automatically remove historical entries or standings. Contact us to
          request access, correction, or deletion of your pool information.
        </p>
        <p>
          We use authenticated access and other safeguards to protect private information, but no
          online service can guarantee complete security. We may disclose information when legally
          required or necessary to protect the service and its users.
        </p>
      </section>
      <section>
        <h2>Your choices and contact</h2>
        <p>
          You can manage pool emails in Email Settings. For account updates, privacy questions, or a
          request to access, correct, or delete your information, contact the Weekly Pools operator
          at <a href="mailto:matt@weeklypools.ca">matt@weeklypools.ca</a>. We may need to verify
          your identity before fulfilling a request.
        </p>
      </section>
      <section>
        <h2>Changes to this policy</h2>
        <p>
          We may update this policy as the service changes. Updates will appear on this page with a
          revised date. We will provide additional notice or request consent where required by
          applicable law.
        </p>
      </section>
    </>
  )
}

function TermsOfService({ onNavigate }: Pick<LegalPageProps, 'onNavigate'>) {
  return (
    <>
      <p className="legal-intro">
        These terms apply to your use of Weekly Pools at weeklypools.ca. By using the service, you
        agree to these terms. If you do not agree, please stop using the service.
      </p>
      <section>
        <h2>Free play, for fun</h2>
        <p>
          Weekly Pools offers sports confidence pools for entertainment. There are no entry fees,
          wagers, real-money betting, or prizes. Points and rankings have no monetary value. Weekly
          Pools is not affiliated with or endorsed by the NHL, PWHL, NFL, or their teams.
        </p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>
          You need a Clerk account and a public username to submit picks. Keep your account
          credentials secure and use only your own account. You are responsible for activity under
          your account and for using the service lawfully. You must be able to agree to these terms
          under the laws that apply to you, or have permission from a parent or legal guardian where
          required.
        </p>
      </section>
      <section>
        <h2>Pool rules and deadlines</h2>
        <p>
          The rules in{' '}
          <ViewLink view="about" onNavigate={onNavigate}>
            About
          </ViewLink>{' '}
          apply to participation. You may submit one entry per league per pool week. A complete
          entry selects a winner for every game and uses each confidence number from 1 to the number
          of games exactly once. Changes must be saved before the displayed deadline. Unsaved or
          incomplete picks do not count as a valid entry.
        </p>
        <p>
          Schedules and scores depend on external feeds. Games may be voided under the pool rules,
          and administrators may correct errors or recalculate standings. Equal point totals share a
          rank. We cannot guarantee that feeds, results, or service availability will always be
          accurate or uninterrupted.
        </p>
      </section>
      <section>
        <h2>Fair use</h2>
        <p>
          Do not impersonate others, use abusive or misleading usernames, create extra accounts to
          evade entry limits, interfere with the service, or attempt to access another person’s
          account or private data. Do not bypass deadlines, authentication, API approvals, or rate
          limits. We may restrict or suspend access or exclude entries that violate these terms or
          undermine fair play.
        </p>
      </section>
      <section>
        <h2>Your information and site content</h2>
        <p>
          You allow us to store and display your username, entries, and results as needed to run the
          pools, standings, and recap emails. Our{' '}
          <ViewLink view="privacy" onNavigate={onNavigate}>
            Privacy Policy
          </ViewLink>{' '}
          explains visibility, email choices, and how we handle personal information. League names,
          logos, and third-party content belong to their respective owners; using this site does not
          grant rights to those materials.
        </p>
      </section>
      <section>
        <h2>Availability and responsibility</h2>
        <p>
          The service is provided “as is” and “as available.” To the extent permitted by applicable
          law, we make no warranties about availability, accuracy, or fitness for a particular
          purpose, and are not liable for losses arising from use of the service, interruptions, or
          errors. Nothing in these terms excludes rights or liability that cannot lawfully be
          excluded. External services and linked websites have their own terms and policies.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          We may change or discontinue features and update these terms. Updated terms will appear
          here with a revised date, with additional notice where required by law. For questions or
          account concerns, contact <a href="mailto:matt@weeklypools.ca">matt@weeklypools.ca</a>.
        </p>
      </section>
    </>
  )
}

export default function LegalPage({ view, onNavigate }: LegalPageProps) {
  const page = views.find((item) => item.id === view)!

  return (
    <article className="legal-page content-wrap" aria-labelledby="legal-title">
      <header className="legal-heading">
        <span className="section-kicker">WEEKLY POOLS / LEGAL</span>
        <h1 id="legal-title">{page.title}</h1>
        <p>
          Last updated: <time dateTime="2026-10-08">October 8, 2026</time>
        </p>
      </header>
      {view === 'privacy' ? (
        <PrivacyPolicy onNavigate={onNavigate} />
      ) : (
        <TermsOfService onNavigate={onNavigate} />
      )}
    </article>
  )
}
