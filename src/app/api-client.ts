import type { JsonValue } from '../shared/json'
import type { ApiFailure } from '../shared/result'

export type ClientApiResult<T> = { ok: true; data: T } | ApiFailure

function apiUrl(path: string): string {
  return `${import.meta.env.VITE_API_BASE_URL || ''}${path}`
}

export async function apiGet<T>(path: string): Promise<ClientApiResult<T>> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
  })

  return (await response.json()) as ClientApiResult<T>
}

export async function apiPost<T>(path: string, body?: JsonValue): Promise<ClientApiResult<T>> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return (await response.json()) as ClientApiResult<T>
}
