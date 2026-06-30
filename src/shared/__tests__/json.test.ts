import { isJsonObject } from '../json'

describe('json helpers', () => {
  it('accepts plain JSON records recursively', () => {
    expect(
      isJsonObject({
        id: 'trip_1',
        count: 2,
        active: true,
        details: { notes: null, tags: ['family', 1, false] },
      }),
    ).toBe(true)
  })

  it('rejects top-level non-record JSON values', () => {
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject(['trip_1'])).toBe(false)
    expect(isJsonObject('trip_1')).toBe(false)
    expect(isJsonObject(1)).toBe(false)
    expect(isJsonObject(true)).toBe(false)
  })

  it('rejects non-JSON objects', () => {
    expect(isJsonObject(new Date())).toBe(false)
    expect(isJsonObject(new Map())).toBe(false)
  })

  it('rejects invalid nested values', () => {
    const cases: unknown[] = [
      { value: undefined },
      { value: () => 'trip_1' },
      { value: Symbol('trip') },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date() },
      { value: new Map() },
      { value: [undefined] },
      { value: Object.assign([1], { extra: undefined }) },
      { value: Array(1) },
    ]

    for (const value of cases) {
      expect(isJsonObject(value)).toBe(false)
    }
  })

  it('rejects cyclic records', () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(isJsonObject(value)).toBe(false)
  })
})
