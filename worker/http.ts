import type { JsonValue } from '../src/shared/json'
import type { ApiErrorCode } from '../src/shared/result'
import { err, ok } from '../src/shared/result'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function jsonHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  result.set('content-type', JSON_HEADERS['content-type'])
  return result
}

export function jsonOk<T extends JsonValue>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(ok(data)), {
    status: init?.status ?? 200,
    headers: jsonHeaders(init?.headers),
  })
}

export function jsonError(status: number, code: ApiErrorCode, message: string): Response {
  return new Response(JSON.stringify(err(code, message)), {
    status,
    headers: JSON_HEADERS,
  })
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(';').map((part) => part.trim())
  const match = parts.find((part) => part.startsWith(`${name}=`))
  if (!match) return null
  try {
    return decodeURIComponent(match.slice(name.length + 1))
  } catch {
    return null
  }
}

export function redirect(location: string, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers)
  resultHeaders.set('location', location)
  return new Response(null, { status: 302, headers: resultHeaders })
}
