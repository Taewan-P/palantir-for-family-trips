import { createId, createToken } from '../src/shared/ids'
import type { JsonValue } from '../src/shared/json'
import { createTripFromTemplate } from '../src/shared/trip-template'
import { sanitizeTripForShare } from '../src/shared/trip-sanitizer'
import { buildGoogleAuthUrl, clearSessionCookie, exchangeGoogleCode, hashToken, sessionCookie, verifyGoogleIdToken } from './auth'
import {
  createInvite,
  createMembership,
  createSession,
  createShareLink,
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
  markInviteAccepted,
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

function appUrl(env: Env, path: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, '')}${path}`
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

      if (request.method === 'GET' && path === '/api/auth/google/start') {
        const state = crypto.randomUUID()
        return redirect(buildGoogleAuthUrl({
          clientId: env.GOOGLE_CLIENT_ID,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          state,
        }))
      }

    if (request.method === 'GET' && path === '/api/auth/google/callback') {
      const code = new URL(request.url).searchParams.get('code')
      if (!code) return jsonError(400, 'bad_request', 'Missing Google authorization code')

      const signedInAt = nowIso()
      const expiresAt = daysFromNow(30)
      const idToken = await exchangeGoogleCode(env, code)
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

      return redirect(appUrl(env, '/trips'), {
        'set-cookie': sessionCookie(env.SESSION_COOKIE_NAME, token, expiresAt),
      })
    }

    if (request.method === 'POST' && path === '/api/auth/logout') {
      return jsonOk({ loggedOut: true }, {
        headers: { 'set-cookie': clearSessionCookie(env.SESSION_COOKIE_NAME) },
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
      const invite = await findActiveInvite(env.DB, await hashToken(acceptToken, env.SESSION_SECRET), acceptedAt)
      if (!invite) return jsonError(404, 'not_found', 'Invite not found')
      if (await findMembership(env.DB, invite.trip_id, user.id)) {
        return jsonError(409, 'conflict', 'User is already a trip member')
      }

      await createMembership(env.DB, {
        tripId: invite.trip_id,
        userId: user.id,
        role: invite.role,
        createdAt: acceptedAt,
      })
      await markInviteAccepted(env.DB, {
        inviteId: invite.id,
        userId: user.id,
        acceptedAt,
      })

      return jsonOk({ tripId: invite.trip_id, role: invite.role })
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
      await disableShareLinks(env.DB, shareTripId, createdAt)
      await createShareLink(env.DB, {
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
