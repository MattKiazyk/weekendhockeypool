export interface Env {
  DB: D1Database
  EMAIL?: SendEmail
  EMAIL_ENABLED?: string
  EMAIL_LAUNCH_AT?: string
  CLERK_WEBHOOK_SIGNING_SECRET?: string
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_SECRET_KEY?: string
  ADMIN_CLERK_USER_ID?: string
}

export interface Player {
  userId: string
  username: string | null
  emailAccount?: import('./email/store').EmailAccount
}
