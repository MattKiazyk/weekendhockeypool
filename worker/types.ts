export interface Env {
  DB: D1Database
  ASSETS?: Fetcher
  API_IP_LIMIT?: RateLimit
  API_READ_LIMIT?: RateLimit
  API_WRITE_LIMIT?: RateLimit
  API_KEY_LIMIT?: RateLimit
  CLERK_NATIVE_AUTHORIZED_PARTIES?: string
  CLERK_JWT_KEY?: string
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
