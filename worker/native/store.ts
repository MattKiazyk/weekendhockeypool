import { nowIso } from '../http'
import type { Env } from '../types'
import { ApiFailure } from './http'

export interface DeviceKey {
  id: string
  label: string
  createdAt: string
  rotatedAt: string | null
  revokedAt: string | null
}

const keyFields =
  'id, label, created_at AS createdAt, rotated_at AS rotatedAt, revoked_at AS revokedAt'

export async function approved(env: Env, userId: string): Promise<boolean> {
  if (env.ADMIN_CLERK_USER_ID && userId === env.ADMIN_CLERK_USER_ID) return true
  return !!(await env.DB.prepare(
    'SELECT clerk_id FROM api_approvals WHERE clerk_id=? AND revoked_at IS NULL',
  )
    .bind(userId)
    .first())
}

export async function keyDigest(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `wpk_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function keyOwner(env: Env, secret: string | null): Promise<string> {
  if (!secret || !/^wpk_[a-f0-9]{64}$/.test(secret))
    throw new ApiFailure(401, 'invalid_api_key', 'A valid X-API-Key is required')
  const row = await env.DB.prepare(
    `SELECT k.clerk_id FROM api_keys k WHERE k.digest=? AND k.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM email_accounts e WHERE e.clerk_id=k.clerk_id AND e.deleted_at IS NOT NULL)
     AND (k.clerk_id=? OR EXISTS (
       SELECT 1 FROM api_approvals a WHERE a.clerk_id=k.clerk_id AND a.revoked_at IS NULL
     ))`,
  )
    .bind(await keyDigest(secret), env.ADMIN_CLERK_USER_ID ?? '')
    .first<{ clerk_id: string }>()
  if (!row) throw new ApiFailure(401, 'invalid_api_key', 'A valid X-API-Key is required')
  return row.clerk_id
}

export async function listKeys(env: Env, userId: string): Promise<DeviceKey[]> {
  return (
    await env.DB.prepare(
      `SELECT ${keyFields} FROM api_keys WHERE clerk_id=? ORDER BY created_at, id`,
    )
      .bind(userId)
      .all<DeviceKey>()
  ).results
}

export async function createKey(env: Env, userId: string, label: string) {
  const secret = newSecret()
  const key = await env.DB.prepare(
    `INSERT INTO api_keys (id, clerk_id, label, digest, created_at)
     SELECT ?, ?, ?, ?, ? WHERE ?=? OR EXISTS (
       SELECT 1 FROM api_approvals WHERE clerk_id=? AND revoked_at IS NULL
     ) RETURNING ${keyFields}`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      label,
      await keyDigest(secret),
      nowIso(),
      userId,
      env.ADMIN_CLERK_USER_ID ?? '',
      userId,
    )
    .first<DeviceKey>()
  if (!key) throw new ApiFailure(403, 'approval_required', 'Native API access requires approval')
  return { key, secret }
}

export async function rotateKey(env: Env, userId: string, id: string) {
  const current = await env.DB.prepare(
    'SELECT digest FROM api_keys WHERE id=? AND clerk_id=? AND revoked_at IS NULL',
  )
    .bind(id, userId)
    .first<{ digest: string }>()
  if (!current) throw new ApiFailure(404, 'not_found', 'Active device key not found')
  const secret = newSecret()
  // Compare-and-swap: only one concurrent rotation can replace the current digest.
  const key = await env.DB.prepare(
    `UPDATE api_keys SET digest=?, rotated_at=? WHERE id=? AND clerk_id=?
     AND digest=? AND revoked_at IS NULL AND (?=? OR EXISTS (
       SELECT 1 FROM api_approvals WHERE clerk_id=? AND revoked_at IS NULL
     )) RETURNING ${keyFields}`,
  )
    .bind(
      await keyDigest(secret),
      nowIso(),
      id,
      userId,
      current.digest,
      userId,
      env.ADMIN_CLERK_USER_ID ?? '',
      userId,
    )
    .first<DeviceKey>()
  if (!key)
    throw new ApiFailure(409, 'key_changed', 'Key changed or access was removed; reload keys')
  return { key, secret }
}

export async function revokeKey(env: Env, userId: string, id: string) {
  const key = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at=COALESCE(revoked_at, ?) WHERE id=? AND clerk_id=? RETURNING ${keyFields}`,
  )
    .bind(nowIso(), id, userId)
    .first<DeviceKey>()
  if (!key) throw new ApiFailure(404, 'not_found', 'Device key not found')
  return { key }
}

export async function revokeUserKeys(env: Env, userId: string) {
  await env.DB.prepare('UPDATE api_keys SET revoked_at=? WHERE clerk_id=? AND revoked_at IS NULL')
    .bind(nowIso(), userId)
    .run()
}

export async function setApproval(env: Env, userId: string, adminId: string, allow: boolean) {
  if (userId === env.ADMIN_CLERK_USER_ID)
    throw new ApiFailure(409, 'admin_approval_fixed', 'The configured admin is implicitly approved')
  const timestamp = nowIso()
  const approval = env.DB.prepare(
    `INSERT INTO api_approvals (clerk_id, approved_at, approved_by, revoked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(clerk_id) DO UPDATE SET approved_at=excluded.approved_at,
       approved_by=excluded.approved_by, revoked_at=excluded.revoked_at`,
  ).bind(userId, timestamp, adminId, allow ? null : timestamp)
  await env.DB.batch(
    allow
      ? [approval]
      : [
          approval,
          env.DB.prepare(
            'UPDATE api_keys SET revoked_at=? WHERE clerk_id=? AND revoked_at IS NULL',
          ).bind(timestamp, userId),
        ],
  )
  return { userId, approved: allow }
}

export async function listApprovals(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT clerk_id AS userId, approved_at AS approvedAt, revoked_at AS revokedAt
     FROM api_approvals WHERE clerk_id!=? ORDER BY clerk_id`,
  )
    .bind(env.ADMIN_CLERK_USER_ID ?? '')
    .all<{ userId: string; approvedAt: string; revokedAt: string | null }>()
  return {
    approvals: [
      ...(env.ADMIN_CLERK_USER_ID
        ? [
            {
              userId: env.ADMIN_CLERK_USER_ID,
              approved: true,
              implicit: true,
              approvedAt: null,
              revokedAt: null,
            },
          ]
        : []),
      ...rows.results.map((row) => ({ ...row, approved: row.revokedAt === null, implicit: false })),
    ],
  }
}
