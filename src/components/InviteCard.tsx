import { useState } from 'react'
import { formatSlateDates, formatSlateDeadline } from '../lib/format'
import { leagueLabel, usesNumberedWeeks } from '../lib/leagues'
import type { Weekend } from '../lib/pool'
import { poolInviteUrl } from '../lib/views'

export default function InviteCard({
  week,
  open,
  prominent = false,
}: {
  week: Weekend
  open: boolean
  prominent?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [manualCopy, setManualCopy] = useState(false)
  const url = poolInviteUrl(week.league, week.startDate)
  const label = `${leagueLabel(week.league)} ${
    usesNumberedWeeks(week.league) && week.weekNumber !== null
      ? `Week ${week.weekNumber}`
      : `${formatSlateDates(week.startDate)} weekend`
  }`
  const deadline = week.lockAt ? formatSlateDeadline(week.lockAt) : null
  const message = open
    ? `I’m in for ${label} on Weekly Pools. Think you can beat me? ${
        deadline
          ? `Get your picks in before ${deadline.date} at ${deadline.time}.`
          : 'Join the pool!'
      }`
    : `My ${label} picks are in on Weekly Pools. Follow the results and join me for a future pool!`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setManualCopy(false)
      setFeedback('Link copied. Send it to a friend!')
    } catch {
      setManualCopy(true)
      setFeedback('Select and copy the link below to send it to a friend.')
    }
  }

  async function share() {
    setBusy(true)
    setFeedback('')
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Weekly Pools', text: message, url })
      } else {
        await copyLink()
      }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) await copyLink()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={`invite-card${prominent ? ' invite-prominent' : ''}`}
      aria-label="Invite friends to Weekly Pools"
    >
      <span className="card-kicker">BETTER WITH FRIENDS</span>
      <h3>
        {prominent
          ? 'More people. More fun.'
          : open
            ? 'Think your friends can beat you?'
            : 'Keep the competition going.'}
      </h3>
      <p className="invite-message">
        {prominent
          ? 'Weekly Pools is more fun with a bigger crowd. Help Matt grow the pool—invite a friend or drop the link in your group chat.'
          : message}
      </p>
      {prominent && (
        <input
          aria-label="Pool invitation link"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <div className="invite-actions">
        {prominent && (
          <button
            type="button"
            className="invite-share"
            autoFocus
            disabled={busy}
            onClick={() => void copyLink()}
          >
            Copy pool link <span aria-hidden="true">↗</span>
          </button>
        )}
        <button
          type="button"
          className={prominent ? '' : 'invite-share'}
          disabled={busy}
          onClick={() => void share()}
        >
          {busy ? 'Opening share…' : 'Invite a friend'} <span aria-hidden="true">↗</span>
        </button>
        {!prominent && (
          <button type="button" disabled={busy} onClick={() => void copyLink()}>
            Copy link
          </button>
        )}
      </div>
      <p className="invite-feedback" role="status">
        {feedback}
      </p>
      {manualCopy && !prominent && (
        <input
          aria-label="Pool invitation link"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </section>
  )
}
