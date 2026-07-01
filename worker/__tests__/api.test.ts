import worker from '../index'
import { hashToken } from '../auth'
import { createTripFromTemplate } from '../../src/shared/trip-template'

const authEnv = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  APP_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_NAME: 'trip_session',
  SESSION_SECRET: 'session-secret',
}

type DbCall = {
  method: 'first' | 'all' | 'run' | 'batch'
  sql: string
  args: readonly unknown[]
}

type QueuedDbResponse = {
  first?: unknown
  all?: readonly unknown[]
}

function dbWithResponses(responses: QueuedDbResponse[] = [], calls: DbCall[] = []): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              calls.push({ method: 'first', sql, args })
              return (responses.shift()?.first ?? null) as T | null
            },
            async all<T>() {
              calls.push({ method: 'all', sql, args })
              return { results: (responses.shift()?.all ?? []) as T[] } as D1Result<T>
            },
            async run() {
              calls.push({ method: 'run', sql, args })
              return { success: true } as D1Result
            },
          }
        },
      }
    },
    async batch(statements: D1PreparedStatement[]) {
      calls.push({ method: 'batch', sql: 'batch', args: [statements.length] })
      return []
    },
  } as unknown as D1Database
}

function envWithDb(db: D1Database): typeof authEnv & { DB: D1Database } {
  return { ...authEnv, DB: db }
}

function signedRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('cookie', 'trip_session=session-token')
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function jsonPost(path: string, body: unknown): Request {
  return signedRequest(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const userRow = {
  id: 'user_1',
  email: 'user@example.com',
  name: 'Test User',
  avatar_url: null,
}

describe('worker api', () => {
  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/nope'), {} as never, {} as never)
    expect(response.status).toBe(404)
  })

  it('redirects Google auth start', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/auth/google/start'), authEnv as never, {} as never)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/google/callback')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_state=')
    expect(response.headers.get('set-cookie')).not.toContain('Secure')
  })

  it('reports missing Google auth configuration', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/start'),
      {
        APP_ORIGIN: 'http://localhost:5173',
        SESSION_COOKIE_NAME: 'trip_session',
      } as never,
      {} as never,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: 'Missing Worker auth configuration: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET',
      },
    })
  })

  it('rejects Google auth callback without state', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/callback?code=code'),
      authEnv as never,
      {} as never,
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_state=;')
  })

  it('rejects Google auth callback with mismatched state', async () => {
    const cookie = `trip_oauth_state=${await hashToken('other-state', 'session-secret')}`
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/callback?code=code&state=returned-state', {
        headers: { cookie },
      }),
      authEnv as never,
      {} as never,
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_state=;')
  })

  it('logs out by clearing the session cookie', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/auth/logout', { method: 'POST' }), authEnv as never, {} as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('trip_session=;')
    await expect(response.json()).resolves.toMatchObject({ data: { loggedOut: true } })
  })

  it.each([
    ['GET', '/api/me'],
    ['GET', '/api/trips'],
    ['POST', '/api/trips'],
    ['POST', '/api/trips/trip_1/invites'],
    ['POST', '/api/invites/invite_token/accept'],
    ['POST', '/api/trips/trip_1/share-link'],
    ['DELETE', '/api/trips/trip_1/share-link'],
  ])('requires a signed-in user for %s %s', async (method, path) => {
    const response = await worker.fetch(new Request(`http://localhost${path}`, { method }), envWithDb(dbWithResponses()) as never, {} as never)

    expect(response.status).toBe(401)
  })

  it('returns the current user for an active session', async () => {
    const response = await worker.fetch(signedRequest('/api/me'), envWithDb(dbWithResponses([{ first: userRow }])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        user: {
          id: 'user_1',
          email: 'user@example.com',
          name: 'Test User',
          avatarUrl: null,
        },
      },
    })
  })

  it('lists trips visible to the signed-in user', async () => {
    const response = await worker.fetch(signedRequest('/api/trips'), envWithDb(dbWithResponses([
      { first: userRow },
      {
        all: [{
          id: 'trip_1',
          title: 'Yosemite',
          slug: 'yosemite-trip_1',
          current_version: 2,
          role: 'editor',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T01:00:00.000Z',
        }],
      },
    ])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { trips: [{ id: 'trip_1', title: 'Yosemite', role: 'editor', currentVersion: 2 }] },
    })
  })

  it('creates a trip for the signed-in user', async () => {
    const response = await worker.fetch(jsonPost('/api/trips', { title: 'Tahoe' }), envWithDb(dbWithResponses([{ first: userRow }])) as never, {} as never)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: { trip: { title: 'Tahoe', role: 'owner', currentVersion: 0 } },
    })
  })

  it('rejects trip creation without a title', async () => {
    const response = await worker.fetch(jsonPost('/api/trips', { title: '   ' }), envWithDb(dbWithResponses([{ first: userRow }])) as never, {} as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { message: 'Trip title is required' } })
  })

  it('creates an invite for trip owners', async () => {
    const response = await worker.fetch(jsonPost('/api/trips/trip_1/invites', { role: 'editor' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'owner' } },
    ])) as never, {} as never)

    expect(response.status).toBe(201)
    const body = await response.json() as { data: { inviteUrl: string; token: string } }
    expect(body.data.token).toBeTruthy()
    expect(body.data.inviteUrl).toBe(`http://localhost:5173/invites/${body.data.token}`)
  })

  it('accepts an active invite for the signed-in user', async () => {
    const response = await worker.fetch(signedRequest('/api/invites/invite_token/accept', { method: 'POST' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { id: 'invite_1', trip_id: 'trip_1', role: 'editor' } },
      { first: null },
      { first: { id: 'invite_1', trip_id: 'trip_1', role: 'editor' } },
    ])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { tripId: 'trip_1', role: 'editor' },
    })
  })

  it('creates and disables sanitized share links for owners', async () => {
    const createResponse = await worker.fetch(signedRequest('/api/trips/trip_1/share-link', { method: 'POST' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'owner' } },
    ])) as never, {} as never)
    const deleteResponse = await worker.fetch(signedRequest('/api/trips/trip_1/share-link', { method: 'DELETE' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'owner' } },
    ])) as never, {} as never)

    expect(createResponse.status).toBe(201)
    const createBody = await createResponse.json() as { data: { shareUrl: string; token: string } }
    expect(createBody.data.token).toBeTruthy()
    expect(createBody.data.shareUrl).toBe(`http://localhost:5173/share/${createBody.data.token}`)
    expect(deleteResponse.status).toBe(200)
    await expect(deleteResponse.json()).resolves.toMatchObject({ data: { disabled: true } })
  })

  it('returns sanitized public share documents', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/share/share_token'), envWithDb(dbWithResponses([
      { first: { trip_id: 'trip_1' } },
      { first: { version: 0, document_json: JSON.stringify(createTripFromTemplate({ id: 'trip_1', title: 'Shared Trip' })) } },
      { all: [] },
    ])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { readOnly: true, trip: { id: 'trip_1', title: 'Shared Trip' } },
    })
  })

  it('forwards trip live requests to the trip Durable Object', async () => {
    const calls: string[] = []
    const response = new Response('forwarded', { status: 426 })
    const env = {
      TRIP_ROOM: {
        idFromName(name: string) {
          calls.push(`id:${name}`)
          return 'room-id'
        },
        get(id: string) {
          calls.push(`get:${id}`)
          return {
            fetch(request: Request) {
              calls.push(new URL(request.url).pathname)
              return response
            },
          }
        },
      },
    }

    await expect(worker.fetch(new Request('http://localhost/api/trips/trip_1/live'), env as never, {} as never)).resolves.toBe(response)
    expect(calls).toEqual(['id:trip_1', 'get:room-id', '/api/trips/trip_1/live'])
  })
})
