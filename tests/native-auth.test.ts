import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeAuth } from '../worker/auth'
import type { Env } from '../worker/types'

// Keep real SDK token verification; replace only private Clerk user lookup.
vi.mock('@clerk/backend', async (importOriginal) => {
  const backend = await importOriginal<typeof import('@clerk/backend')>()
  return {
    ...backend,
    createClerkClient: (options: Parameters<typeof backend.createClerkClient>[0]) => {
      const client = backend.createClerkClient(options)
      const getUser = vi.fn()
      getUser.mockResolvedValue({
        id: 'user_native',
        username: 'native',
        createdAt: 0,
        updatedAt: 1,
        primaryEmailAddressId: null,
        emailAddresses: [],
      })
      client.users.getUser = getUser
      return client
    },
  }
})

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = {
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.example.test$').toString('base64')}`,
  CLERK_SECRET_KEY: 'sk_test_local',
  CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  CLERK_NATIVE_AUTHORIZED_PARTIES: 'https://weeklypools.ca,http://127.0.0.1:5173',
} as Env
function token(claims: Record<string, unknown> = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local' })).toString(
    'base64url',
  )
  const body = Buffer.from(
    JSON.stringify({
      iss: 'https://clerk.example.test',
      sub: 'user_native',
      sid: 'sess_native',
      iat: now,
      nbf: now - 10,
      exp: now + 60,
      v: 2,
      ...claims,
    }),
  ).toString('base64url')
  const unsigned = `${header}.${body}`
  const signature = Buffer.from(createSign('RSA-SHA256').update(unsigned).sign(key)).toString(
    'base64url',
  )
  return `${unsigned}.${signature}`
}
async function authenticate(jwt: string | null, cookies?: string) {
  return nativeAuth(
    new Request('https://api.weeklypools.ca/v1/me', {
      headers: {
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
        ...(cookies ? { cookie: cookies } : {}),
      },
    }),
    env,
  )
}
afterEach(() => vi.restoreAllMocks())
describe('real Clerk native session verification', () => {
  it('accepts signed native tokens without azp and trusted browser-issued tokens', async () => {
    expect(
      await nativeAuth(
        new Request('https://api.weeklypools.ca/v1/me', {
          headers: { authorization: `bearer ${token()}` },
        }),
        env,
      ),
    ).toMatchObject({ userId: 'user_native' })
    expect(await authenticate(token())).toMatchObject({ userId: 'user_native', username: 'native' })
    expect(await authenticate(token({ azp: 'https://weeklypools.ca' }))).toMatchObject({
      userId: 'user_native',
    })
    expect(await authenticate(token({ azp: 'http://127.0.0.1:5173' }))).toMatchObject({
      userId: 'user_native',
    })
  })
  it('rejects untrusted or empty authorized-party claims after signature verification', async () => {
    expect(await authenticate(token({ azp: 'https://untrusted.example' }))).toBeNull()
    expect(await authenticate(token({ azp: '' }))).toBeNull()
  })
  it('rejects expired, future, tampered, wrong-signature, and non-session tokens', async () => {
    const now = Math.floor(Date.now() / 1000)
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    for (const jwt of [
      token({ exp: now - 100 }),
      token({ nbf: now + 100 }),
      token({ sid: null }),
      token({ iss: 'https://wrong-instance.example' }),
      token({}, other),
      'invalid',
      `${token()}x`,
    ])
      expect(await authenticate(jwt)).toBeNull()
  })
  it('never authenticates cookies and never falls back to them for an invalid bearer', async () => {
    const cookie = `__session=${token()}`
    expect(await authenticate(null, cookie)).toBeNull()
    expect(await authenticate('invalid', cookie)).toBeNull()
  })
})
