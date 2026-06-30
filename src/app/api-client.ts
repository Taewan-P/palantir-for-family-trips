import type { JsonValue } from '../shared/json'
import type { ApiResult } from '../shared/result'

function apiUrl(path: string): string {
  return `${import.meta.env.VITE_API_BASE_URL || ''}${path}`
}

export async function apiGet<T extends JsonValue>(path: string): Promise<ApiResult<T>> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
  })

  return (await response.json()) as ApiResult<T>
}

export async function apiPost<T extends JsonValue>(path: string, body?: JsonValue): Promise<ApiResult<T>> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return (await response.json()) as ApiResult<T>
}
