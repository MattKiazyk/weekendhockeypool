import { verifyWebhook } from '@clerk/backend/webhooks'
import { error, json } from '../http'
import type { Env } from '../types'
import { accountStatement, welcomeStatement, type EmailAccount } from './store'

export async function clerkWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) return error('Webhook is not configured', 503)
  const original = request.clone()
  let event
  try {
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET })
  } catch {
    return error('Invalid webhook signature', 400)
  }
  const eventId = request.headers.get('svix-id')!
  if (
    await env.DB.prepare('SELECT event_id FROM email_webhooks WHERE event_id=?')
      .bind(eventId)
      .first()
  )
    return json({ received: true })
  const payload = (await original.json()) as { timestamp?: number }
  const eventAt = typeof payload.timestamp === 'number' ? payload.timestamp : 0
  const timestamp = new Date().toISOString()
  const statements: D1PreparedStatement[] = []
  if (event.type === 'user.deleted' && event.data.id) {
    // Tombstones are permanent; a late create/update cannot restore a deleted ID.
    statements.push(
      env.DB.prepare(
        `INSERT INTO email_accounts (clerk_id, created_at, source_updated_at, source_event_at, deleted_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(clerk_id) DO UPDATE SET email=NULL, verified=0, username=NULL, deleted_at=excluded.deleted_at`,
      ).bind(event.data.id, timestamp, eventAt, eventAt, timestamp),
    )
    statements.push(
      env.DB.prepare(
        "UPDATE email_jobs SET status='skipped', last_error='account_deleted' WHERE clerk_id=? AND status='pending'",
      ).bind(event.data.id),
    )
  } else if (event.type === 'user.created' || event.type === 'user.updated') {
    const user = event.data
    const primary = user.email_addresses.find(
      (address) => address.id === user.primary_email_address_id,
    )
    const account: EmailAccount = {
      userId: user.id,
      username: user.username,
      email: primary?.email_address ?? null,
      verified: primary?.verification?.status === 'verified',
      createdAt: new Date(user.created_at).toISOString(),
      updatedAt: user.updated_at,
      eventAt,
    }
    statements.push(accountStatement(env.DB, account), welcomeStatement(env, user.id))
  }
  statements.push(
    env.DB.prepare(
      'INSERT OR IGNORE INTO email_webhooks (event_id, processed_at) VALUES (?, ?)',
    ).bind(eventId, timestamp),
  )
  await env.DB.batch(statements)
  return json({ received: true })
}
