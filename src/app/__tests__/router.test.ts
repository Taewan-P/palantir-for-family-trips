import { describe, expect, it } from 'vitest'

import { matchRoute } from '../router'

describe('matchRoute', () => {
  it('matches trip routes', () => {
    expect(matchRoute('/trips/trip_123')).toEqual({ name: 'trip', tripId: 'trip_123' })
  })

  it('matches share routes', () => {
    expect(matchRoute('/share/token_123')).toEqual({ name: 'share', token: 'token_123' })
  })
})
