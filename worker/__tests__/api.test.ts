import worker from '../index'
import { hashToken } from '../auth'

describe('worker api', () => {
  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/nope'), {} as never, {} as never)
    expect(response.status).toBe(404)
  })

  it('redirects Google auth start', async () => {
    const env = {
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
      APP_ORIGIN: 'http://localhost:5173',
      SESSION_COOKIE_NAME: 'trip_session',
      SESSION_SECRET: 'session-secret',
    }
    const response = await worker.fetch(new Request('http://localhost/api/auth/google/start'), env as never, {} as never)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_state=')
    expect(response.headers.get('set-cookie')).not.toContain('Secure')
  })

  it('rejects Google auth callback without state', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/auth/google/callback?code=code'),
      {} as never,
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
      { SESSION_SECRET: 'session-secret' } as never,
      {} as never,
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toContain('trip_oauth_state=;')
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
