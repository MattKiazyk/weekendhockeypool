export interface Env {
  DB: D1Database
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_SECRET_KEY?: string
  ADMIN_CLERK_USER_ID?: string
}

export interface Player {
  userId: string
  username: string | null
}
