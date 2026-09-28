import { addDays } from './pool'

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(
    new Date(value),
  )
const dayIso = (date: string) => `${date}T12:00:00Z`
export const formatDay = (date: string) =>
  dateLabel(dayIso(date), { weekday: 'long', month: 'short', day: 'numeric' })
export const formatTime = (iso: string) =>
  dateLabel(iso, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
export const formatSlateDates = (start: string) => {
  const end = addDays(start, 2)
  const startMonth = dateLabel(dayIso(start), { month: 'short' }).toUpperCase()
  const endMonth = dateLabel(dayIso(end), { month: 'short' }).toUpperCase()
  const startDay = dateLabel(dayIso(start), { day: 'numeric' })
  const endDay = dateLabel(dayIso(end), { day: 'numeric' })
  return startMonth === endMonth
    ? `${startMonth} ${startDay}–${endDay}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}`
}
