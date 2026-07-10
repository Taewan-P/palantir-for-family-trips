import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { AuthenticatedUser, Env } from './env'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export type BuildGoogleAuthUrlInput = {
  clientId: string
  redirectUri: string
  state: string
}

export function buildGoogleAuthUrl(input: BuildGoogleAuthUrlInput): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export async function hashToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type CookieOptions = {
  secure?: boolean
}

function secureCookieAttribute(options?: CookieOptions): string {
  return options?.secure === false ? '' : '; Secure'
}

export function sessionCookie(name: string, token: string, expiresAt: Date, options?: CookieOptions): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export function clearSessionCookie(name: string, options?: CookieOptions): string {
  return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export function oauthStateCookie(name: string, stateHash: string, expiresAt: Date, options?: CookieOptions): string {
  return `${name}=${encodeURIComponent(stateHash)}; Path=/api/auth/google/callback; Expires=${expiresAt.toUTCString()}; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export function clearOauthStateCookie(name: string, options?: CookieOptions): string {
  return `${name}=; Path=/api/auth/google/callback; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export function oauthNextCookie(name: string, nextPath: string, expiresAt: Date, options?: CookieOptions): string {
  return `${name}=${encodeURIComponent(nextPath)}; Path=/api/auth/google/callback; Expires=${expiresAt.toUTCString()}; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export function clearOauthNextCookie(name: string, options?: CookieOptions): string {
  return `${name}=; Path=/api/auth/google/callback; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureCookieAttribute(options)}; SameSite=Lax`
}

export async function exchangeGoogleCode(env: Env, code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`)
  const data = await response.json() as { id_token?: unknown }
  if (typeof data.id_token !== 'string') throw new Error('Google token exchange response did not include id_token')
  return data.id_token
}

export async function verifyGoogleIdToken(env: Env, idToken: string): Promise<AuthenticatedUser> {
  const result = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: 'https://accounts.google.com',
    audience: env.GOOGLE_CLIENT_ID,
  })

  const email = result.payload.email
  const name = result.payload.name
  if (typeof result.payload.sub !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
    throw new Error('Google id token is missing required profile claims')
  }

  return {
    id: result.payload.sub,
    email,
    name,
    avatarUrl: typeof result.payload.picture === 'string' ? result.payload.picture : null,
  }
}
