import { formatDay, formatSlateDates } from '../lib/format'
import type { LeagueId, WeekListing } from '../lib/pool'

interface WeekendNavProps {
  weeks: WeekListing[]
  league: LeagueId
  activeStart: string
  currentStart: string
  onChange: (start: string) => void
}

function DateButtons({
  dates,
  league,
  weekNumbers,
  activeStart,
  currentStart,
  count,
  onChange,
  className,
}: {
  dates: string[]
  league: LeagueId
  weekNumbers: Map<string, number | null>
  activeStart: string
  currentStart: string
  count: number
  onChange: (start: string) => void
  className: string
}) {
  const activeIndex = dates.indexOf(activeStart)
  const first = Math.max(0, Math.min(activeIndex - Math.floor(count / 2), dates.length - count))
  const visible = dates.slice(first, first + count)
  return (
    <nav
      className={`weekend-nav ${className}`}
      aria-label={league === 'nfl' ? 'Choose NFL week' : 'Choose weekend'}
    >
      <button
        type="button"
        className="weekend-step"
        aria-label={`Previous available ${league === 'nfl' ? 'NFL week' : 'weekend'}`}
        disabled={activeIndex === 0}
        onClick={() => onChange(dates[activeIndex - 1])}
      >
        ‹
      </button>
      <div className="weekend-dates">
        {visible.map((start) => {
          const thisWeekend = league !== 'nfl' && start === currentStart
          return (
            <button
              key={start}
              type="button"
              className={`weekend-date ${start === activeStart ? 'active' : ''} ${thisWeekend ? 'current-weekend' : ''}`}
              aria-current={start === activeStart ? 'date' : undefined}
              aria-label={
                league === 'nfl'
                  ? `NFL ${start.slice(0, 4)} week ${weekNumbers.get(start)}`
                  : `${thisWeekend ? 'This weekend,' : 'Weekend of'} ${formatDay(start)}, ${start.slice(0, 4)}`
              }
              onClick={() => onChange(start)}
            >
              <span>
                {league === 'nfl'
                  ? `WEEK ${weekNumbers.get(start)}`
                  : thisWeekend
                    ? 'THIS WEEKEND'
                    : formatSlateDates(start)}
              </span>
              <small>{thisWeekend ? formatSlateDates(start) : start.slice(0, 4)}</small>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="weekend-step"
        aria-label={`Next available ${league === 'nfl' ? 'NFL week' : 'weekend'}`}
        disabled={activeIndex === dates.length - 1}
        onClick={() => onChange(dates[activeIndex + 1])}
      >
        ›
      </button>
    </nav>
  )
}

export default function WeekendNav({
  weeks,
  league,
  activeStart,
  currentStart,
  onChange,
}: WeekendNavProps) {
  const dates = [...new Set([...weeks.map((week) => week.start_date), activeStart])].sort()
  const weekNumbers = new Map(weeks.map((week) => [week.start_date, week.week_number]))
  if (dates.length < 2) return null
  return (
    <>
      <DateButtons
        dates={dates}
        league={league}
        weekNumbers={weekNumbers}
        activeStart={activeStart}
        currentStart={currentStart}
        count={5}
        onChange={onChange}
        className="wide"
      />
      <DateButtons
        dates={dates}
        league={league}
        weekNumbers={weekNumbers}
        activeStart={activeStart}
        currentStart={currentStart}
        count={3}
        onChange={onChange}
        className="compact"
      />
    </>
  )
}
