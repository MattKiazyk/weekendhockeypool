import { createClerkClient } from '@clerk/backend'
import { accountFromClerk } from './email/store'
import type { Env, Player } from './types'

export async function auth(request: Request, env: Env): Promise<Player | null> {
  if (!env.CLERK_PUBLISHABLE_KEY || !env.CLERK_SECRET_KEY)
    throw new Error('Clerk is not configured')
  const client = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  })
  const state = await client.authenticateRequest(request, {
    authorizedParties: [new URL(request.url).origin],
    acceptsToken: 'session_token',
  })
  const userId = state.toAuth()?.userId
  if (!state.isAuthenticated || !userId) return null
  const user = await client.users.getUser(userId)
  return { userId, username: user.username, emailAccount: accountFromClerk(user) }
}
