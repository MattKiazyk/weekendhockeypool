import { useState } from 'react'
import { useAdminUsers } from '../hooks/usePool'
import type { AdminEntryStatus } from '../lib/api'
import { formatSlateDates } from '../lib/format'
import { leagueLabel } from '../lib/leagues'
import type { LeagueId } from '../lib/pool'
import type { PoolSession } from '../lib/session'

const labels: Record<AdminEntryStatus, string> = {
  submitted: 'Submitted',
  incomplete: 'Incomplete',
  'not-entered': 'Not entered',
  'no-pool': 'No pool',
}

export default function AdminUsers({ session, demo }: { session: PoolSession; demo: boolean }) {
  const [selected, setSelected] = useState<Partial<Record<LeagueId, string>>>({})
  const [search, setSearch] = useState('')
  const { data, loading, error, refresh } = useAdminUsers(session, demo, selected)
  const users =
    data?.users.filter((user) =>
      (user.username ?? 'No username').toLowerCase().includes(search.toLowerCase()),
    ) ?? []
  return (
    <section className="admin-panel admin-users" aria-labelledby="admin-users-title">
      <div className="results-intro">
        <span className="card-kicker">PRIVATE PARTICIPATION OVERVIEW</span>
        <h3 id="admin-users-title">WEEKLY ENTRIES.</h3>
        <p>
          Accounts stored by Weekly Pools, including users who haven’t entered. Each league defaults
          to its latest released pool. Incomplete entries need updated picks.
        </p>
      </div>
      <div className="admin-form">
        <label>
          Find a user
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button onClick={refresh} disabled={loading}>
          Refresh users
        </button>
      </div>
      {loading && (
        <p className="admin-users-message" role="status">
          Loading users…
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {demo && (
        <p className="admin-users-message">
          User accounts are available in the live admin section.
        </p>
      )}
      {data && (
        <div className="admin-users-scroll" tabIndex={0} aria-label="Weekly user entries">
          <table className="admin-users-table">
            <caption>
              {data.users.length} {data.users.length === 1 ? 'account' : 'accounts'} ·{' '}
              {users.length} shown
            </caption>
            <thead>
              <tr>
                <th scope="col">User</th>
                {data.columns.map((column) => (
                  <th scope="col" key={column.league}>
                    <label>
                      {leagueLabel(column.league)}
                      <select
                        aria-label={`${leagueLabel(column.league)} participation week`}
                        value={column.selectedStart ?? ''}
                        disabled={!column.weeks.length}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [column.league]: event.target.value,
                          }))
                        }
                      >
                        {!column.selectedStart && <option value="">No released pool</option>}
                        {column.weeks.map((week) => (
                          <option key={week.startDate} value={week.startDate}>
                            {week.weekNumber ? `Week ${week.weekNumber} · ` : ''}
                            {formatSlateDates(week.startDate, week.startDate)} ·{' '}
                            {week.startDate.slice(0, 4)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <th scope="row">{user.username ?? 'No username'}</th>
                  {data.columns.map(({ league }) => (
                    <td key={league}>
                      <span className={`admin-entry-status ${user.entries[league]}`}>
                        {labels[user.entries[league]]}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={5}>No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
