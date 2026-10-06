import { addDays, easternDate } from './pool'

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(
    new Date(value),
  )
const dayIso = (date: string) => `${date}T12:00:00Z`
export const formatDay = (date: string) =>
  dateLabel(dayIso(date), { weekday: 'long', month: 'short', day: 'numeric' })
export const formatTime = (iso: string) =>
  dateLabel(iso, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
export const formatSlateDates = (start: string, end = addDays(start, 2)) => {
  const startMonth = dateLabel(dayIso(start), { month: 'short' }).toUpperCase()
  const endMonth = dateLabel(dayIso(end), { month: 'short' }).toUpperCase()
  const startDay = dateLabel(dayIso(start), { day: 'numeric' })
  const endDay = dateLabel(dayIso(end), { day: 'numeric' })
  if (start === end) return `${startMonth} ${startDay}`
  return startMonth === endMonth
    ? `${startMonth} ${startDay}–${endDay}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}`
}

export const formatDeadline = (iso: string) =>
  `${dateLabel(iso, { dateStyle: 'full', timeStyle: 'short' })} Eastern`

export function formatSlateDeadline(iso: string, now = Date.now()): { date: string; time: string } {
  const today = easternDate(now)
  const weekday = new Date(dayIso(today)).getUTCDay()
  const weekStart = addDays(today, -((weekday + 6) % 7))
  const date = easternDate(iso)
  const thisWeek = date >= weekStart && date < addDays(weekStart, 7)
  const day = dateLabel(iso, {
    weekday: 'long',
    ...(!thisWeek && { month: 'short', day: 'numeric' }),
    ...(!thisWeek && date.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }),
  })
  const time = formatTime(iso)
    .replace(':00 ', ' ')
    .replace(/[AP]M/, (part) => part.toLowerCase())
  return { date: day, time }
}
