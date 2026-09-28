import { formatDay, formatSlateDates } from '../lib/format'
import type { WeekListing } from '../lib/pool'

interface WeekendNavProps {
  weeks: WeekListing[]
  activeStart: string
  onChange: (start: string) => void
}

function DateButtons({
  dates,
  activeStart,
  count,
  onChange,
  className,
}: {
  dates: string[]
  activeStart: string
  count: number
  onChange: (start: string) => void
  className: string
}) {
  const activeIndex = dates.indexOf(activeStart)
  const first = Math.max(0, Math.min(activeIndex - Math.floor(count / 2), dates.length - count))
  const visible = dates.slice(first, first + count)
  return (
    <nav className={`weekend-nav ${className}`} aria-label="Choose weekend">
      <button
        type="button"
        className="weekend-step"
        aria-label="Previous available weekend"
        disabled={activeIndex === 0}
        onClick={() => onChange(dates[activeIndex - 1])}
      >
        ‹
      </button>
      <div className="weekend-dates">
        {visible.map((start) => (
          <button
            key={start}
            type="button"
            className={`weekend-date ${start === activeStart ? 'active' : ''}`}
            aria-current={start === activeStart ? 'date' : undefined}
            aria-label={`Weekend of ${formatDay(start)}, ${start.slice(0, 4)}`}
            onClick={() => onChange(start)}
          >
            <span>{formatSlateDates(start)}</span>
            <small>{start.slice(0, 4)}</small>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="weekend-step"
        aria-label="Next available weekend"
        disabled={activeIndex === dates.length - 1}
        onClick={() => onChange(dates[activeIndex + 1])}
      >
        ›
      </button>
    </nav>
  )
}

export default function WeekendNav({ weeks, activeStart, onChange }: WeekendNavProps) {
  const dates = [...new Set([...weeks.map((week) => week.start_date), activeStart])].sort()
  if (dates.length < 2) return null
  return (
    <>
      <DateButtons
        dates={dates}
        activeStart={activeStart}
        count={5}
        onChange={onChange}
        className="wide"
      />
      <DateButtons
        dates={dates}
        activeStart={activeStart}
        count={3}
        onChange={onChange}
        className="compact"
      />
    </>
  )
}
