import { api } from './api'
import { error } from './http'
import { scheduled } from './sync'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await api(request, env)
    } catch (cause) {
      console.error(cause)
      return error(cause instanceof Error ? cause.message : 'Unexpected server error', 500)
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(scheduled(env))
  },
} satisfies ExportedHandler<Env>
