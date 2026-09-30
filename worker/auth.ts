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

// Native requests authenticate only the explicit bearer token. Clerk verifies its
// signature and timestamps before we inspect claims. Native tokens may omit azp;
// when present, it must match a configured trusted login origin.
export async function nativeAuth(request: Request, env: Env): Promise<Player | null> {
  if (!/^Bearer \S+$/i.test(request.headers.get('authorization') ?? '')) return null
  if (!env.CLERK_PUBLISHABLE_KEY || !env.CLERK_SECRET_KEY)
    throw new Error('Clerk is not configured')
  const client = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  })
  const headers = new Headers(request.headers)
  headers.set('authorization', headers.get('authorization')!.replace(/^bearer /i, 'Bearer '))
  headers.delete('cookie')
  const state = await client.authenticateRequest(new Request(request.url, { headers }), {
    acceptsToken: 'session_token',
    jwtKey: env.CLERK_JWT_KEY,
  })
  const session = state.toAuth()
  if (!state.isAuthenticated || !session?.userId || !session.sessionId) return null
  const parties = (env.CLERK_NATIVE_AUTHORIZED_PARTIES ?? 'https://weeklypools.ca')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  // A configured JWT public key must still belong to the configured Clerk
  // instance. Derive its issuer from the same publishable key the SDK parses.
  const encodedHost = env.CLERK_PUBLISHABLE_KEY.replace(/^pk_(test|live)_/, '')
  const issuer = `https://${atob(encodedHost.replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '')}`
  if (session.sessionClaims?.iss !== issuer) return null
  const azp = session.sessionClaims?.azp
  if (azp !== undefined && (!azp || !parties.includes(azp))) return null
  const user = await client.users.getUser(session.userId)
  return { userId: user.id, username: user.username, emailAccount: accountFromClerk(user) }
}
