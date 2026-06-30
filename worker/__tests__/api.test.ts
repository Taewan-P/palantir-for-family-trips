import worker from '../index'

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
    }
    const response = await worker.fetch(new Request('http://localhost/api/auth/google/start'), env as never, {} as never)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('https://accounts.google.com')
  })
})
