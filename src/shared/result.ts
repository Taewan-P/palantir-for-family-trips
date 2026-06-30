import type { JsonValue } from './json'

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error'

export type ApiSuccess<T extends JsonValue> = {
  ok: true
  data: T
}

export type ApiFailure = {
  ok: false
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type ApiResult<T extends JsonValue> = ApiSuccess<T> | ApiFailure

export function ok<T extends JsonValue>(data: T): ApiSuccess<T> {
  return { ok: true, data }
}

export function err(code: ApiErrorCode, message: string): ApiFailure {
  return { ok: false, error: { code, message } }
}
