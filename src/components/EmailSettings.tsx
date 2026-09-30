import { useState } from 'react'
import { useEmailSettings } from '../hooks/usePool'
import { leagues } from '../lib/leagues'
import type { EmailPreferences } from '../lib/email'
import type { LeagueId } from '../lib/pool'
import type { PoolSession } from '../lib/session'

export default function EmailSettingsPage({
  session,
  demo,
}: {
  session: PoolSession
  demo: boolean
}) {
  const { settings, loading, saving, message, error, save, retry } = useEmailSettings(session, demo)
  const [draft, setDraft] = useState<EmailPreferences | null>(null)
  function changePreference(league: LeagueId, kind: 'reminder' | 'recap', enabled: boolean) {
    setDraft((current) => ({
      ...(current ?? settings.preferences),
      [league]: { ...(current ?? settings.preferences)[league], [kind]: enabled },
    }))
  }
  if (!session.signedIn)
    return (
      <section className="email-settings content-wrap">
        <h1>Email Settings</h1>
        <p>Sign in to choose which league emails you receive.</p>
        <button className="sign-in-button" onClick={session.signIn}>
          Sign in
        </button>
      </section>
    )
  const preferences = draft ?? settings.preferences
  return (
    <section className="email-settings content-wrap" aria-labelledby="email-settings-title">
      <span className="section-kicker">YOUR ACCOUNT</span>
      <h1 id="email-settings-title">EMAIL SETTINGS</h1>
      <p>Choose your league reminders and recaps. All optional emails start off.</p>
      {loading ? (
        <p role="status">Loading email settings…</p>
      ) : (
        <>
          <div className="email-account-summary">
            <strong>{settings.email ?? 'No primary email address on your account'}</strong>
            <p>
              {settings.verified
                ? 'Verified account email'
                : 'Verify your primary email in your account before emails can be delivered.'}
            </p>
            <p>
              A one-time welcome email is sent to new accounts after verification. It is not
              controlled by these switches.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save(preferences)
            }}
          >
            <fieldset disabled={saving || (error !== '' && settings.email === null)}>
              <legend className="sr-only">Optional league emails</legend>
              {leagues.map(({ id, label }) => (
                <div
                  className="email-league-settings"
                  key={id}
                  role="group"
                  aria-labelledby={`email-${id}-title`}
                >
                  <h2 id={`email-${id}-title`}>{label}</h2>
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences[id].reminder}
                      onChange={(event) => changePreference(id, 'reminder', event.target.checked)}
                    />
                    <span>
                      <strong>Pick reminder</strong>
                      <small>
                        {id === 'nfl' ? 'Thursday' : 'Friday'} at 9 a.m. Eastern, if your entry is
                        incomplete and picks are still open.
                      </small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={preferences[id].recap}
                      onChange={(event) => changePreference(id, 'recap', event.target.checked)}
                    />
                    <span>
                      <strong>Weekly recap</strong>
                      <small>
                        The next 9 a.m. Eastern after final standings, even if you didn’t enter.
                        Subscribe before finalization to receive that week’s recap.
                      </small>
                    </span>
                  </label>
                </div>
              ))}
              <button className="sign-in-button" type="submit">
                {saving ? 'Saving…' : 'Save email settings'}
              </button>
            </fieldset>
          </form>
          <p className="email-settings-note">
            Eastern time follows daylight saving time. Replies to noreply@weeklypools.ca are not
            monitored.{demo ? ' This is a local preview; no emails will be sent.' : ''}
          </p>
        </>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error} {!settings.email && <button onClick={retry}>Try again</button>}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
    </section>
  )
}
