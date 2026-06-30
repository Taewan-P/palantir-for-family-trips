import { createId, createToken, timingSafeEqualString } from '../ids'

describe('ids', () => {
  it('creates prefixed ids', () => {
    const id = createId('trip')
    expect(id.startsWith('trip_')).toBe(true)
    expect(id.length).toBeGreaterThan(20)
  })

  it('creates long URL-safe tokens', () => {
    const token = createToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('compares strings without leaking equality through length shortcuts in callers', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true)
    expect(timingSafeEqualString('abc', 'abd')).toBe(false)
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false)
  })
})
