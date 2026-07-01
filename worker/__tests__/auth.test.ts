import { buildGoogleAuthUrl, hashToken, oauthStateCookie, sessionCookie } from '../auth'

describe('auth helpers', () => {
  it('builds a Google auth URL with state', () => {
    const url = new URL(buildGoogleAuthUrl({
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/api/auth/google/callback',
      state: 'state_123',
    }))

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('scope')).toContain('openid')
    expect(url.searchParams.get('state')).toBe('state_123')
  })

  it('hashes tokens deterministically', async () => {
    await expect(hashToken('secret-token', 'session-secret')).resolves.toBe(await hashToken('secret-token', 'session-secret'))
  })

  it('creates a secure session cookie', () => {
    const cookie = sessionCookie('trip_session', 'raw-token', new Date('2026-07-02T00:00:00.000Z'))
    expect(cookie).toContain('trip_session=raw-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('creates a scoped OAuth state cookie', () => {
    const cookie = oauthStateCookie('trip_oauth_state', 'hashed-state', new Date('2026-07-01T00:10:00.000Z'))
    expect(cookie).toContain('trip_oauth_state=hashed-state')
    expect(cookie).toContain('Path=/api/auth/google/callback')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('can omit Secure for local HTTP cookies', () => {
    const expiresAt = new Date('2026-07-02T00:00:00.000Z')
    expect(sessionCookie('trip_session', 'raw-token', expiresAt, { secure: false })).not.toContain('Secure')
    expect(oauthStateCookie('trip_oauth_state', 'hashed-state', expiresAt, { secure: false })).not.toContain('Secure')
  })
})
