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

function guidedTripPayload() {
  return {
    title: 'Japan Summer 2026',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    destinationName: 'Tokyo',
    basecampAddress: '1 Chome Marunouchi, Tokyo',
    families: [
      { displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 },
      { displayName: 'Kim Household', origin: 'Busan', adults: 1, kids: 2 },
    ],
  }
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

  it('uses forwarded host headers for proxied Google auth redirects', async () => {
    const response = await worker.fetch(
      new Request('http://127.0.0.1:8787/api/auth/google/start', {
        headers: {
          'x-forwarded-host': 'localhost:5173',
          'x-forwarded-proto': 'http',
        },
      }),
      authEnv as never,
      {} as never,
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback')
  })

  it('uses the deployed custom domain for production Google auth redirects', async () => {
    const response = await worker.fetch(
      new Request('https://travelops.chungjungsoo.dev/api/auth/google/start'),
      { ...authEnv, APP_ORIGIN: 'https://travelops.chungjungsoo.dev' } as never,
      {} as never,
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.searchParams.get('redirect_uri')).toBe('https://travelops.chungjungsoo.dev/api/auth/google/callback')
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('stores a sanitized post-login path during Google auth start', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/start?next=/invites/invite_token'),
      authEnv as never,
      {} as never,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_next=%2Finvites%2Finvite_token')
  })

  it('falls back to trips for unsafe post-login paths', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/start?next=https://evil.example/steal'),
      authEnv as never,
      {} as never,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_next=%2Ftrips')
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
    ['GET', '/api/trips/trip_1'],
    ['DELETE', '/api/trips/trip_1'],
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

  it('creates a guided trip for the signed-in user', async () => {
    const calls: DbCall[] = []
    const payload = guidedTripPayload()
    const response = await worker.fetch(jsonPost('/api/trips', payload), envWithDb(dbWithResponses([{ first: userRow }], calls)) as never, {} as never)

    expect(response.status).toBe(201)
    const body = await response.json() as { data: { trip: { id: string; title: string; role: 'owner'; currentVersion: number } } }
    expect(body.data).toEqual({
      trip: {
        id: body.data.trip.id,
        title: 'Japan Summer 2026',
        role: 'owner',
        currentVersion: 0,
      },
    })
    expect(body.data.trip.id).toMatch(/^trip_/)

    const tripInsert = calls.find((call) => call.sql.includes('INSERT INTO trips'))
    expect(tripInsert?.args[0]).toBe(body.data.trip.id)
    expect(tripInsert?.args[1]).toBe('Japan Summer 2026')
    expect(tripInsert?.args[3]).toBe('user_1')

    const membershipInsert = calls.find((call) => call.sql.includes('INSERT INTO memberships'))
    expect(membershipInsert?.args.slice(0, 3)).toEqual([body.data.trip.id, 'user_1', 'owner'])

    const snapshotInsert = calls.find((call) => call.sql.includes('INSERT INTO trip_snapshots'))
    expect(snapshotInsert?.args[1]).toBe(body.data.trip.id)
    expect(snapshotInsert?.args[2]).toBe(0)
    expect(snapshotInsert?.args[4]).toBe('user_1')
    expect(typeof snapshotInsert?.args[3]).toBe('string')
    const snapshot = JSON.parse(snapshotInsert?.args[3] as string) as {
      id?: string
      title: string
      templateKind: string
      days: { date: string }[]
      families: { title: string }[]
      routes: unknown[]
      itineraryItems: unknown[]
      meals: unknown[]
      activities: unknown[]
      expenses: unknown[]
      tasks: unknown[]
    }
    expect(snapshot.id).toBe(body.data.trip.id)
    expect(snapshot.title).toBe('Japan Summer 2026')
    expect(snapshot.templateKind).toBe('guided')
    expect(snapshot.days.map((day) => day.date)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12'])
    expect(snapshot.families.map((family) => family.title)).toEqual(['Park Household', 'Kim Household'])
    expect(snapshot.routes).toEqual([])
    expect(snapshot.itineraryItems).toEqual([])
    expect(snapshot.meals).toEqual([])
    expect(snapshot.activities).toEqual([])
    expect(snapshot.expenses).toEqual([])
    expect(snapshot.tasks).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain('Parkers')
    expect(JSON.stringify(snapshot)).not.toContain('Jiangs')
    expect(JSON.stringify(snapshot)).not.toContain('Riveras')
    expect(JSON.stringify(snapshot)).not.toContain('Duckfat')
    expect(JSON.stringify(snapshot)).not.toContain('Portland Head Light')
  })

  it.each([
    { label: 'missing title', payload: { ...guidedTripPayload(), title: '   ' }, message: 'Trip title is required' },
    { label: 'invalid date order', payload: { ...guidedTripPayload(), startDate: '2026-07-12', endDate: '2026-07-10' }, message: 'End date must be on or after start date' },
    { label: 'missing families', payload: { ...guidedTripPayload(), families: undefined } },
    { label: 'negative adults', payload: { ...guidedTripPayload(), families: [{ displayName: 'Park Household', adults: -1, kids: 1 }] } },
    { label: 'negative kids', payload: { ...guidedTripPayload(), families: [{ displayName: 'Park Household', adults: 1, kids: -1 }] } },
    { label: 'more than 31 days', payload: { ...guidedTripPayload(), startDate: '2026-07-01', endDate: '2026-08-01' } },
  ])('rejects guided trip creation with $label', async ({ payload, message }) => {
    const response = await worker.fetch(jsonPost('/api/trips', payload), envWithDb(dbWithResponses([{ first: userRow }])) as never, {} as never)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ error: { code: 'bad_request' } })
    if (message) expect(body).toMatchObject({ error: { message } })
  })

  it('returns a member trip document by id', async () => {
    const response = await worker.fetch(signedRequest('/api/trips/trip_1'), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'editor' } },
      { first: { version: 0, document_json: JSON.stringify(createTripFromTemplate({ id: 'trip_1', title: 'Member Trip' })) } },
      { all: [] },
      { all: [{ user_id: 'user_1', email: 'editor@example.com', name: 'Editor User', avatar_url: null, role: 'editor', created_at: '2026-07-01T00:00:00.000Z' }] },
    ])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        trip: { id: 'trip_1', title: 'Member Trip' },
        role: 'editor',
        version: 0,
        members: [{ userId: 'user_1', email: 'editor@example.com', name: 'Editor User', role: 'editor' }],
      },
    })
  })

  it('rejects authenticated non-members when loading a trip document', async () => {
    const response = await worker.fetch(signedRequest('/api/trips/trip_1'), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: null } },
    ])) as never, {} as never)

    expect(response.status).toBe(403)
  })

  it('archives trips for owners', async () => {
    const response = await worker.fetch(signedRequest('/api/trips/trip_1', { method: 'DELETE' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'owner' } },
    ])) as never, {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { archived: true } })
  })

  it('rejects trip archiving for editors', async () => {
    const response = await worker.fetch(signedRequest('/api/trips/trip_1', { method: 'DELETE' }), envWithDb(dbWithResponses([
      { first: userRow },
      { first: { role: 'editor' } },
    ])) as never, {} as never)

    expect(response.status).toBe(403)
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
    const body = await response.json() as { data: { readOnly: boolean; trip: { id: string; title: string; stayItems: { id: string; summary?: string }[] } } }
    expect(body).toMatchObject({
      data: { readOnly: true, trip: { id: 'trip_1', title: 'Shared Trip' } },
    })
    expect(body.data.trip.stayItems.find((item) => item.id === 'stay-gate-access')?.summary)
      .toBe('Arrival logistics are intentionally generalized in the public version.')
    expect(JSON.stringify(body)).not.toContain('guest passes')
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
