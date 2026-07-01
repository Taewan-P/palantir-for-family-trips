import { describe, expect, it } from 'vitest'

import { authStartHref } from '../LoginPage'

describe('authStartHref', () => {
  it('uses the current browser host for local Worker auth', () => {
    expect(authStartHref(undefined, true, 'localhost')).toBe('http://localhost:8787/api/auth/google/start')
  })

  it('uses same-origin auth in production when no API base is configured', () => {
    expect(authStartHref(undefined, false)).toBe('/api/auth/google/start')
  })
})
