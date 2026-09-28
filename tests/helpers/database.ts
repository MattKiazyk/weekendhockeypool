import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

// Run the real migrations and SQL against SQLite; only the D1 transport is adapted.
export function createTestDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  for (const migration of readdirSync('migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'))
  }

  function prepare(sql: string) {
    let values: SQLInputValue[] = []
    return {
      bind(...args: SQLInputValue[]) {
        values = args
        return this
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values), success: true }
      },
      async run() {
        return { meta: sqlite.prepare(sql).run(...values), success: true }
      },
    }
  }

  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db, sqlite }
}
