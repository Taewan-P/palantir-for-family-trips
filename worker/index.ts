import { createId, createToken, timingSafeEqualString } from '../src/shared/ids'
import type { JsonValue } from '../src/shared/json'
import { createTripFromTemplate } from '../src/shared/trip-template'
import { sanitizeTripForShare } from '../src/shared/trip-sanitizer'
import { buildGoogleAuthUrl, clearOauthStateCookie, clearSessionCookie, exchangeGoogleCode, hashToken, oauthStateCookie, sessionCookie, verifyGoogleIdToken } from './auth'
import {
  claimActiveInvite,
  createInvite,
  createMembership,
  createSession,
  createTrip,
  disableShareLinks,
  findActiveInvite,
  findActiveShareLink,
  findMembership,
  findSessionUser,
  getTripAccess,
  insertSnapshot,
  listVisibleTrips,
  loadHydratedTripSnapshot,
  rotateShareLink,
  upsertGoogleUser,
} from './db'
import type { Env } from './env'
import { jsonError, jsonOk, parseCookie, redirect } from './http'
export { TripRoom } from './trip-room'

type WorkerApi = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}

type SignedInUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export type TripRole = 'owner' | 'editor'

const OAUTH_STATE_COOKIE_NAME = 'trip_oauth_state'
const OAUTH_STATE_TTL_MINUTES = 10
const GOOGLE_AUTH_CONFIG_KEYS = [
  'APP_ORIGIN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_COOKIE_NAME',
  'SESSION_SECRET',
] as const

export function canWriteTrip(role: TripRole | null): boolean {
  return role === 'owner' || role === 'editor'
}

export function canManageAccess(role: TripRole | null): boolean {
  return role === 'owner'
}

function routePath(request: Request): string {
  return new URL(request.url).pathname
}

function nowIso(): string {
  return new Date().toISOString()
}

function daysFromNow(days: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

function minutesFromNow(minutes: number): Date {
  const date = new Date()
  date.setUTCMinutes(date.getUTCMinutes() + minutes)
  return date
}

function appUrl(env: Env, path: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, '')}${path}`
}

function cookieOptions(request: Request): { secure: boolean } {
  return { secure: new URL(request.url).protocol === 'https:' }
}

function googleAuthConfigError(env: Env): Response | null {
  const missing = GOOGLE_AUTH_CONFIG_KEYS.filter((key) => !env[key]?.trim())
  if (missing.length === 0) return null
  return jsonError(500, 'internal_error', `Missing Worker auth configuration: ${missing.join(', ')}`)
}

function googleRedirectUri(request: Request): string {
  return new URL('/api/auth/google/callback', request.url).toString()
}

function slugify(title: string, tripId: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${slug || 'trip'}-${tripId.slice(-8)}`
}

function jsonRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function requireUser(request: Request, env: Env): Promise<SignedInUser | Response> {
  const token = parseCookie(request.headers.get('cookie'), env.SESSION_COOKIE_NAME)
  if (!token) return jsonError(401, 'unauthorized', 'Sign in required')

  const user = await findSessionUser(env.DB, await hashToken(token, env.SESSION_SECRET), nowIso())
  if (!user) return jsonError(401, 'unauthorized', 'Sign in required')

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
  }
}

async function readTripTitle(request: Request): Promise<string | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }

  if (!jsonRequestObject(body) || typeof body.title !== 'string') return null
  const title = body.title.trim()
  return title.length > 0 ? title : null
}

function routeMatch(path: string, pattern: RegExp): string | null {
  const match = pattern.exec(path)
  return match?.[1] ?? null
}

function tripJson(document: ReturnType<typeof sanitizeTripForShare>): JsonValue {
  return document as unknown as JsonValue
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const path = routePath(request)
      const liveTripId = routeMatch(path, /^\/api\/trips\/([^/]+)\/live$/)
      if (liveTripId) {
        const id = env.TRIP_ROOM.idFromName(liveTripId)
        return env.TRIP_ROOM.get(id).fetch(request)
      }

      if (request.method === 'GET' && path === '/api/auth/google/start') {
        const configError = googleAuthConfigError(env)
        if (configError) return configError

        const state = crypto.randomUUID()
        const stateHash = await hashToken(state, env.SESSION_SECRET)
        return redirect(buildGoogleAuthUrl({
          clientId: env.GOOGLE_CLIENT_ID,
          redirectUri: googleRedirectUri(request),
          state,
        }), {
          'set-cookie': oauthStateCookie(OAUTH_STATE_COOKIE_NAME, stateHash, minutesFromNow(OAUTH_STATE_TTL_MINUTES), cookieOptions(request)),
        })
      }

    if (request.method === 'GET' && path === '/api/auth/google/callback') {
      const configError = googleAuthConfigError(env)
      if (configError) return configError

      const clearStateHeader = { 'set-cookie': clearOauthStateCookie(OAUTH_STATE_COOKIE_NAME, cookieOptions(request)) }
      const state = new URL(request.url).searchParams.get('state')
      const stateCookie = parseCookie(request.headers.get('cookie'), OAUTH_STATE_COOKIE_NAME)
      if (!state || !stateCookie) {
        return jsonError(400, 'bad_request', 'Invalid Google OAuth state', { headers: clearStateHeader })
      }
      const stateHash = await hashToken(state, env.SESSION_SECRET)
      if (!timingSafeEqualString(stateHash, stateCookie)) {
        return jsonError(400, 'bad_request', 'Invalid Google OAuth state', { headers: clearStateHeader })
      }

      const code = new URL(request.url).searchParams.get('code')
      if (!code) {
        return jsonError(400, 'bad_request', 'Missing Google authorization code', { headers: clearStateHeader })
      }

      const signedInAt = nowIso()
      const expiresAt = daysFromNow(30)
      const idToken = await exchangeGoogleCode(env, code, googleRedirectUri(request))
      const googleProfile = await verifyGoogleIdToken(env, idToken)
      const user = await upsertGoogleUser(env.DB, {
        id: createId('user'),
        googleSub: googleProfile.id,
        email: googleProfile.email,
        name: googleProfile.name,
        avatarUrl: googleProfile.avatarUrl,
        now: signedInAt,
      })
      const token = createToken()
      await createSession(env.DB, {
        id: createId('session'),
        userId: user.id,
        tokenHash: await hashToken(token, env.SESSION_SECRET),
        expiresAt: expiresAt.toISOString(),
        createdAt: signedInAt,
      })

      const headers = new Headers()
      headers.append('set-cookie', sessionCookie(env.SESSION_COOKIE_NAME, token, expiresAt, cookieOptions(request)))
      headers.append('set-cookie', clearOauthStateCookie(OAUTH_STATE_COOKIE_NAME, cookieOptions(request)))
      return redirect(appUrl(env, '/trips'), headers)
    }

    if (request.method === 'POST' && path === '/api/auth/logout') {
      return jsonOk({ loggedOut: true }, {
        headers: { 'set-cookie': clearSessionCookie(env.SESSION_COOKIE_NAME, cookieOptions(request)) },
      })
    }

    if (request.method === 'GET' && path === '/api/me') {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user
      return jsonOk({ user })
    }

    if (request.method === 'GET' && path === '/api/trips') {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user

      const trips = await listVisibleTrips(env.DB, user.id)
      return jsonOk({
        trips: trips.map((trip) => ({
          id: trip.id,
          title: trip.title,
          slug: trip.slug,
          currentVersion: trip.current_version,
          role: trip.role,
          createdAt: trip.created_at,
          updatedAt: trip.updated_at,
        })),
      })
    }

    if (request.method === 'POST' && path === '/api/trips') {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user

      const title = await readTripTitle(request)
      if (!title) return jsonError(400, 'bad_request', 'Trip title is required')

      const createdAt = nowIso()
      const tripId = createId('trip')
      const snapshotId = createId('snapshot')
      const document = createTripFromTemplate({ id: tripId, title })
      await createTrip(env.DB, {
        id: tripId,
        title,
        slug: slugify(title, tripId),
        ownerUserId: user.id,
        now: createdAt,
      })
      await createMembership(env.DB, {
        tripId,
        userId: user.id,
        role: 'owner',
        createdAt,
      })
      await insertSnapshot(env.DB, {
        id: snapshotId,
        tripId,
        version: 0,
        document,
        userId: user.id,
        createdAt,
      })

      return jsonOk({ trip: { id: tripId, title, role: 'owner', currentVersion: 0 } }, { status: 201 })
    }

    const inviteTripId = routeMatch(path, /^\/api\/trips\/([^/]+)\/invites$/)
    if (request.method === 'POST' && inviteTripId) {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user
      const access = await getTripAccess(env.DB, inviteTripId, user.id)
      if (!access.exists) return jsonError(404, 'not_found', 'Trip not found')
      if (!canManageAccess(access.role)) {
        return jsonError(403, 'forbidden', 'Owner access required')
      }

      const token = createToken()
      const createdAt = nowIso()
      await createInvite(env.DB, {
        id: createId('invite'),
        tripId: inviteTripId,
        tokenHash: await hashToken(token, env.SESSION_SECRET),
        expiresAt: daysFromNow(14).toISOString(),
        createdByUserId: user.id,
        createdAt,
      })

      return jsonOk({ token, inviteUrl: appUrl(env, `/invites/${token}`) }, { status: 201 })
    }

    const acceptToken = routeMatch(path, /^\/api\/invites\/([^/]+)\/accept$/)
    if (request.method === 'POST' && acceptToken) {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user

      const acceptedAt = nowIso()
      const tokenHash = await hashToken(acceptToken, env.SESSION_SECRET)
      const invite = await findActiveInvite(env.DB, tokenHash, acceptedAt)
      if (!invite) return jsonError(404, 'not_found', 'Invite not found')
      if (await findMembership(env.DB, invite.trip_id, user.id)) {
        return jsonError(409, 'conflict', 'User is already a trip member')
      }

      const claimedInvite = await claimActiveInvite(env.DB, {
        tokenHash,
        userId: user.id,
        now: acceptedAt,
      })
      if (!claimedInvite) return jsonError(404, 'not_found', 'Invite not found')

      await createMembership(env.DB, {
        tripId: claimedInvite.trip_id,
        userId: user.id,
        role: claimedInvite.role,
        createdAt: acceptedAt,
      })

      return jsonOk({ tripId: claimedInvite.trip_id, role: claimedInvite.role })
    }

    const shareTripId = routeMatch(path, /^\/api\/trips\/([^/]+)\/share-link$/)
    if (request.method === 'POST' && shareTripId) {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user
      const access = await getTripAccess(env.DB, shareTripId, user.id)
      if (!access.exists) return jsonError(404, 'not_found', 'Trip not found')
      if (!canManageAccess(access.role)) {
        return jsonError(403, 'forbidden', 'Owner access required')
      }

      const token = createToken()
      const createdAt = nowIso()
      await rotateShareLink(env.DB, {
        id: createId('share'),
        tripId: shareTripId,
        tokenHash: await hashToken(token, env.SESSION_SECRET),
        createdByUserId: user.id,
        now: createdAt,
      })

      return jsonOk({ token, shareUrl: appUrl(env, `/share/${token}`) }, { status: 201 })
    }

    if (request.method === 'DELETE' && shareTripId) {
      const user = await requireUser(request, env)
      if (user instanceof Response) return user
      const access = await getTripAccess(env.DB, shareTripId, user.id)
      if (!access.exists) return jsonError(404, 'not_found', 'Trip not found')
      if (!canManageAccess(access.role)) {
        return jsonError(403, 'forbidden', 'Owner access required')
      }

      await disableShareLinks(env.DB, shareTripId, nowIso())
      return jsonOk({ disabled: true })
    }

    const shareToken = routeMatch(path, /^\/api\/share\/([^/]+)$/)
    if (request.method === 'GET' && shareToken) {
      const share = await findActiveShareLink(env.DB, await hashToken(shareToken, env.SESSION_SECRET))
      if (!share) return jsonError(404, 'not_found', 'Share link not found')

      const document = await loadHydratedTripSnapshot(env.DB, share.trip_id)
      if (!document) return jsonError(404, 'not_found', 'Trip snapshot not found')

      return jsonOk({ trip: tripJson(sanitizeTripForShare(document)), readOnly: true })
    }

      return jsonError(404, 'not_found', 'Route not found')
    } catch {
      return jsonError(500, 'internal_error', 'Unexpected server error')
    }
  },
} satisfies ExportedHandler<Env> & WorkerApi

export default worker
