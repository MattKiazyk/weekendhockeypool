export type SaveFeedback = { kind: 'success' | 'error'; text: string }

export default function SaveToast({
  feedback,
  onDismiss,
}: {
  feedback: SaveFeedback
  onDismiss: () => void
}) {
  return (
    <div
      className={`save-toast ${feedback.kind}`}
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="save-toast-icon" aria-hidden="true">
        {feedback.kind === 'success' ? '✓' : '!'}
      </span>
      <div>
        <strong>{feedback.kind === 'success' ? 'PICKS SAVED' : 'COULD NOT SAVE'}</strong>
        <p>{feedback.text}</p>
      </div>
      <button type="button" aria-label="Dismiss save notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
