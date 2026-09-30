import { api } from '../api'
import { nativeAuth } from '../auth'
import { json } from '../http'
import type { Env, Player } from '../types'
import { isLeague, leagues } from '../../src/lib/leagues'
import { isEmailPreferences } from '../../src/lib/email'
import { ApiFailure, failureResponse, readBody, secureResponse } from './http'
import {
  approved,
  createKey,
  keyOwner,
  listApprovals,
  listKeys,
  revokeKey,
  revokeUserKeys,
  rotateKey,
  setApproval,
} from './store'

// Also checked against the committed OpenAPI contract by tests.
export const nativeRoutes = {
  '/v1/leagues': ['GET'],
  '/v1/open-leagues': ['GET'],
  '/v1/week': ['GET'],
  '/v1/weeks': ['GET'],
  '/v1/entrants': ['GET'],
  '/v1/standings': ['GET'],
  '/v1/season': ['GET'],
  '/v1/me': ['GET'],
  '/v1/entry': ['GET', 'PUT'],
  '/v1/picks': ['GET'],
  '/v1/email-settings': ['GET', 'PUT'],
  '/v1/keys': ['GET', 'POST'],
  '/v1/keys/{id}': ['DELETE'],
  '/v1/keys/{id}/rotate': ['POST'],
  '/v1/admin/approvals': ['GET'],
  '/v1/admin/approvals/{userId}': ['PUT', 'DELETE'],
  '/v1/admin/users/{userId}/keys': ['DELETE'],
} as const

const personalRoutes = new Set(['/v1/me', '/v1/entry', '/v1/picks', '/v1/email-settings'])
const statusCodes: Record<number, string> = {
  400: 'invalid_request',
  401: 'sign_in_required',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'username_required',
  503: 'temporarily_unavailable',
}

type LimiterName = 'API_IP_LIMIT' | 'API_READ_LIMIT' | 'API_WRITE_LIMIT' | 'API_KEY_LIMIT'
async function limit(env: Env, name: LimiterName, key: string) {
  if (!env[name])
    throw new ApiFailure(503, 'temporarily_unavailable', 'API protection is unavailable')
  let result: { success: boolean }
  try {
    result = await env[name].limit({ key })
  } catch {
    throw new ApiFailure(503, 'temporarily_unavailable', 'API protection is unavailable')
  }
  if (!result.success)
    throw new ApiFailure(429, 'too_many_requests', 'Too many requests; try again later', {
      'retry-after': '60',
    })
}

function matchRoute(path: string): { route: keyof typeof nativeRoutes; id?: string } | null {
  if (Object.hasOwn(nativeRoutes, path)) return { route: path as keyof typeof nativeRoutes }
  const key = /^\/v1\/keys\/([a-zA-Z0-9_-]{1,128})(\/rotate)?$/.exec(path)
  if (key) return { route: key[2] ? '/v1/keys/{id}/rotate' : '/v1/keys/{id}', id: key[1] }
  const approval = /^\/v1\/admin\/approvals\/(user_[a-zA-Z0-9]{1,120})$/.exec(path)
  if (approval) return { route: '/v1/admin/approvals/{userId}', id: approval[1] }
  const revoke = /^\/v1\/admin\/users\/(user_[a-zA-Z0-9]{1,120})\/keys$/.exec(path)
  if (revoke) return { route: '/v1/admin/users/{userId}/keys', id: revoke[1] }
  return null
}

async function signedIn(request: Request, env: Env): Promise<Player> {
  const user = await nativeAuth(request, env)
  if (!user)
    throw new ApiFailure(401, 'sign_in_required', 'A valid Clerk bearer session is required')
  return user
}

function validateBody(path: string, body: Record<string, unknown>) {
  if (path === '/v1/keys') {
    if (
      Object.keys(body).some((key) => key !== 'label') ||
      typeof body.label !== 'string' ||
      !body.label.trim() ||
      body.label.trim().length > 100
    )
      throw new ApiFailure(
        400,
        'invalid_request',
        'Provide a device label between 1 and 100 characters',
      )
  } else if (path === '/v1/entry') {
    if (
      Object.keys(body).some((key) => !['league', 'startDate', 'picks'].includes(key)) ||
      (body.league !== undefined && !isLeague(body.league)) ||
      !Array.isArray(body.picks) ||
      typeof body.startDate !== 'string' ||
      body.picks.some(
        (pick) =>
          !pick ||
          typeof pick !== 'object' ||
          Array.isArray(pick) ||
          Object.keys(pick).some((key) => !['gameId', 'side', 'confidence'].includes(key)) ||
          !Number.isSafeInteger(pick.gameId) ||
          pick.gameId < 1 ||
          !Number.isSafeInteger(pick.confidence) ||
          pick.confidence < 1 ||
          !['away', 'home'].includes(pick.side),
      )
    )
      throw new ApiFailure(400, 'invalid_request', 'Invalid entry body')
  } else if (path === '/v1/email-settings') {
    if (!isEmailPreferences(body))
      throw new ApiFailure(
        400,
        'invalid_request',
        'Expected reminder and recap switches for each league',
      )
  } else if (Object.keys(body).length) {
    throw new ApiFailure(400, 'invalid_request', 'Expected an empty JSON object')
  }
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  await limit(env, 'API_IP_LIMIT', request.headers.get('cf-connecting-ip') ?? 'local')
  const url = new URL(request.url)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new ApiFailure(400, 'https_required', 'Use HTTPS')
  const match = matchRoute(url.pathname)
  if (!match) throw new ApiFailure(404, 'not_found', 'API route not found')
  const allowed: readonly string[] = nativeRoutes[match.route]
  if (!allowed.includes(request.method))
    throw new ApiFailure(405, 'method_not_allowed', 'Method not allowed', {
      allow: allowed.join(', '),
    })
  const management = match.route.startsWith('/v1/keys') || match.route.startsWith('/v1/admin/')
  let user: Player | undefined
  let owner: string
  if (management) {
    user = await signedIn(request, env)
    owner = user.userId
  } else {
    owner = await keyOwner(env, request.headers.get('x-api-key'))
  }
  await limit(env, request.method === 'GET' ? 'API_READ_LIMIT' : 'API_WRITE_LIMIT', owner)
  if (management) {
    await limit(env, 'API_KEY_LIMIT', owner)
    if (match.route.startsWith('/v1/admin/')) {
      if (!env.ADMIN_CLERK_USER_ID || owner !== env.ADMIN_CLERK_USER_ID)
        throw new ApiFailure(403, 'admin_required', 'Admin access required')
    } else if (!(await approved(env, owner))) {
      throw new ApiFailure(403, 'approval_required', 'Native API access requires approval')
    }
  }
  if (personalRoutes.has(match.route)) {
    user = await signedIn(request, env)
    if (user.userId !== owner)
      throw new ApiFailure(
        403,
        'key_owner_mismatch',
        'Session and device key must belong to the same user',
      )
  }
  let body: Record<string, unknown> | undefined
  if (request.method === 'POST' || request.method === 'PUT') {
    body = await readBody(request)
    validateBody(match.route, body)
  }
  if (match.route === '/v1/keys') {
    return request.method === 'GET'
      ? json({ keys: await listKeys(env, owner) })
      : json(await createKey(env, owner, (body!.label as string).trim()), 201)
  }
  if (match.route === '/v1/keys/{id}/rotate') return json(await rotateKey(env, owner, match.id!))
  if (match.route === '/v1/keys/{id}') return json(await revokeKey(env, owner, match.id!))
  if (match.route === '/v1/admin/approvals') return json(await listApprovals(env))
  if (match.route === '/v1/admin/approvals/{userId}')
    return json(await setApproval(env, match.id!, owner, request.method === 'PUT'))
  if (match.route === '/v1/admin/users/{userId}/keys') {
    await revokeUserKeys(env, match.id!)
    return json({ revoked: true })
  }
  if (match.route === '/v1/leagues') return json({ leagues })
  // Use the same player handlers and domain rules as the website. This route list
  // deliberately excludes webhooks and pool administration.
  url.pathname = url.pathname.replace('/v1/', '/api/')
  const headers = new Headers(request.headers)
  headers.delete('cookie')
  const forwarded = new Request(url, {
    method: request.method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const response = await api(forwarded, env, user)
  if (response.ok) return response
  const result = (await response.json()) as { error?: string }
  throw new ApiFailure(
    response.status,
    statusCodes[response.status] ?? 'request_failed',
    result.error ?? 'Request failed',
  )
}

export async function nativeApi(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    return secureResponse(await dispatch(request, env), requestId)
  } catch (cause) {
    if (!(cause instanceof ApiFailure)) {
      // Never include exception messages, request URLs, tokens, or user data.
      console.error('Native API request failed', { requestId })
    }
    const failure =
      cause instanceof ApiFailure
        ? cause
        : new ApiFailure(500, 'internal_error', 'Unexpected server error')
    return secureResponse(failureResponse(failure, requestId), requestId)
  }
}
