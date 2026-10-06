import { describe, expect, it } from 'vitest'
import { formatSlateDeadline } from '../src/lib/format'

describe('short deadline labels', () => {
  it('shows only the weekday and time for the current Eastern calendar week', () => {
    expect(formatSlateDeadline('2026-10-09T23:00:00Z', Date.parse('2026-10-06T12:00:00Z'))).toEqual(
      {
        date: 'Friday',
        time: '7 pm EDT',
      },
    )
  })

  it.each([
    ['2026-10-02T23:00:00Z', 'Friday, Oct 2', '7 pm EDT'],
    ['2026-10-16T23:30:00Z', 'Friday, Oct 16', '7:30 pm EDT'],
  ])('includes the date for a deadline outside this week: %s', (iso, date, time) => {
    expect(formatSlateDeadline(iso, Date.parse('2026-10-06T12:00:00Z'))).toEqual({ date, time })
  })

  it('uses Eastern dates when UTC has already moved into Monday', () => {
    const sundayNight = Date.parse('2026-10-12T02:00:00Z')
    expect(formatSlateDeadline('2026-10-12T03:30:00Z', sundayNight)).toEqual({
      date: 'Sunday',
      time: '11:30 pm EDT',
    })
    expect(formatSlateDeadline('2026-10-16T23:00:00Z', sundayNight)).toEqual({
      date: 'Friday, Oct 16',
      time: '7 pm EDT',
    })
  })

  it('starts a new calendar week on Monday in Eastern time', () => {
    expect(formatSlateDeadline('2026-10-16T23:00:00Z', Date.parse('2026-10-12T04:00:00Z'))).toEqual(
      {
        date: 'Friday',
        time: '7 pm EDT',
      },
    )
  })

  it('uses the deadline’s EST or EDT offset across daylight saving changes', () => {
    const now = Date.parse('2026-10-26T12:00:00Z')
    expect(formatSlateDeadline('2026-10-30T23:00:00Z', now)).toEqual({
      date: 'Friday',
      time: '7 pm EDT',
    })
    expect(formatSlateDeadline('2026-11-02T00:00:00Z', now)).toEqual({
      date: 'Sunday',
      time: '7 pm EST',
    })
  })

  it('adds the year for another year, while keeping this week concise across New Year', () => {
    const now = Date.parse('2027-01-01T12:00:00Z')
    expect(formatSlateDeadline('2026-12-25T00:00:00Z', now)).toEqual({
      date: 'Thursday, Dec 24, 2026',
      time: '7 pm EST',
    })
    expect(formatSlateDeadline('2026-12-31T00:00:00Z', now)).toEqual({
      date: 'Wednesday',
      time: '7 pm EST',
    })
  })
})
