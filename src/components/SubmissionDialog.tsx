import { useEffect, useRef } from 'react'
import { formatDay, formatSlateDates, formatSlateDeadline, formatTime } from '../lib/format'
import { leagueLabel, usesNumberedWeeks } from '../lib/leagues'
import type { Weekend } from '../lib/pool'
import InviteCard from './InviteCard'

export default function SubmissionDialog({
  week,
  open,
  onDismiss,
}: {
  week: Weekend
  open: boolean
  onDismiss: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const deadline = week.lockAt ? formatSlateDeadline(week.lockAt) : null
  const dates = week.games.map((game) => game.easternDate).sort()
  const lastGame = week.games
    .map((game) => game.startUtc)
    .sort()
    .at(-1)
  const numbered = usesNumberedWeeks(week.league)

  useEffect(() => {
    const element = dialog.current!
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="submission-dialog"
      aria-labelledby="submission-title"
      aria-describedby="submission-summary"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onDismiss()
        }
      }}
    >
      <button
        type="button"
        className="submission-close"
        aria-label="Close submission summary"
        onClick={onDismiss}
      >
        ×
      </button>
      <span className="card-kicker">✓ PICKS SAVED</span>
      <h2 id="submission-title">You’re in!</h2>
      <p id="submission-summary" className="submission-summary">
        {leagueLabel(week.league)}
        {numbered && week.weekNumber !== null ? ` Week ${week.weekNumber}` : ''}
        {' · '}
        {formatSlateDates(dates[0] ?? week.startDate, dates.at(-1) ?? week.startDate)}
        {' · '}
        {week.games.length} {week.games.length === 1 ? 'game ranked' : 'games ranked'}
      </p>
      <dl className="submission-details">
        <div>
          <dt>{open ? 'You can edit until' : 'Entry deadline'}</dt>
          <dd>
            {week.lockAt && deadline ? (
              <time dateTime={week.lockAt}>
                {deadline.date} at {deadline.time}
              </time>
            ) : (
              'The first game starts'
            )}
          </dd>
        </div>
        <div>
          <dt>When to check results</dt>
          <dd>
            {lastGame && (
              <>
                Last game starts {formatDay(dates.at(-1)!)} at {formatTime(lastGame)}.{' '}
              </>
            )}
            Final standings appear once every game is final or void.
          </dd>
        </div>
      </dl>
      <InviteCard week={week} open={open} prominent />
      <button type="button" className="submission-done" onClick={onDismiss}>
        Back to my picks
      </button>
    </dialog>
  )
}
