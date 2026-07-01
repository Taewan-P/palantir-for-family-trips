import { describe, expect, it } from 'vitest'

import { authStartHref } from '../LoginPage'

describe('authStartHref', () => {
  it('uses the local Worker directly in dev when no API base is configured', () => {
    expect(authStartHref(undefined, true)).toBe('http://127.0.0.1:8787/api/auth/google/start')
  })

  it('uses same-origin auth in production when no API base is configured', () => {
    expect(authStartHref(undefined, false)).toBe('/api/auth/google/start')
  })
})
