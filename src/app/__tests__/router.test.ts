import { describe, expect, it } from 'vitest'

import { matchRoute } from '../router'

describe('matchRoute', () => {
  it('matches trip routes', () => {
    expect(matchRoute('/trips/trip_123')).toEqual({ name: 'trip', tripId: 'trip_123' })
  })

  it('matches share routes', () => {
    expect(matchRoute('/share/token_123')).toEqual({ name: 'share', token: 'token_123' })
  })

  it('matches invite routes', () => {
    expect(matchRoute('/invites/token_123')).toEqual({ name: 'invite', token: 'token_123' })
  })

  it('falls back instead of throwing on malformed encoded routes', () => {
    expect(() => matchRoute('/trips/%')).not.toThrow()
    expect(() => matchRoute('/share/%E0%A4%A')).not.toThrow()
    expect(() => matchRoute('/invites/%E0%A4%A')).not.toThrow()
    expect(matchRoute('/trips/%')).toEqual({ name: 'trips' })
    expect(matchRoute('/share/%E0%A4%A')).toEqual({ name: 'trips' })
    expect(matchRoute('/invites/%E0%A4%A')).toEqual({ name: 'trips' })
  })
})
