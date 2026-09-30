import { processEmails } from './email/delivery'
import { api } from './api'
import { nativeApi } from './native/api'
import { error } from './http'
import { scheduled } from './sync'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === 'api.weeklypools.ca') return nativeApi(request, env)
    // Local development can exercise v1 without changing DNS. Production website
    // and alternate Worker hostnames never expose native routes.
    if (['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.startsWith('/v1/'))
      return nativeApi(request, env)
    try {
      if (!url.pathname.startsWith('/api/'))
        return env.ASSETS ? await env.ASSETS.fetch(request) : error('Not found', 404)
      return await api(request, env)
    } catch {
      console.error('Website request failed')
      return error('Unexpected server error', 500)
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          await scheduled(env)
        } catch (cause) {
          console.error('Scheduled sync failed', cause)
        }
        try {
          await processEmails(env)
        } catch (cause) {
          console.error('Email processing failed', cause)
        }
      })(),
    )
  },
} satisfies ExportedHandler<Env>
