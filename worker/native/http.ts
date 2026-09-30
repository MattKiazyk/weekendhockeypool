import { json } from '../http'

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export function failureResponse(failure: ApiFailure, requestId: string): Response {
  const response = json(
    { error: { code: failure.code, message: failure.message, requestId } },
    failure.status,
  )
  if (failure.status === 401)
    response.headers.set(
      'www-authenticate',
      failure.code === 'invalid_api_key'
        ? 'ApiKey realm="Weekly Pools"'
        : 'Bearer realm="Weekly Pools", error="invalid_token"',
    )
  for (const [name, value] of Object.entries(failure.headers)) response.headers.set(name, value)
  return response
}

export function secureResponse(response: Response, requestId: string): Response {
  response.headers.set('cache-control', 'no-store')
  response.headers.set('x-content-type-options', 'nosniff')
  response.headers.set('x-request-id', requestId)
  return response
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new ApiFailure(415, 'unsupported_media_type', 'Use application/json for request bodies')
  const max = 64 * 1024
  const length = request.headers.get('content-length')
  if (length && Number(length) > max)
    throw new ApiFailure(413, 'payload_too_large', 'Request body exceeds 64 KiB')
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > max) {
          await reader.cancel()
          throw new ApiFailure(413, 'payload_too_large', 'Request body exceeds 64 KiB')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ApiFailure(400, 'invalid_request', 'Invalid JSON body')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiFailure(400, 'invalid_request', 'Expected a JSON object')
  return body as Record<string, unknown>
}
