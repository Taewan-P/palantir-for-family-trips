import { err, ok } from '../result'

describe('api result helpers', () => {
  it('creates success envelopes', () => {
    expect(ok({ id: 'trip_1' })).toEqual({ ok: true, data: { id: 'trip_1' } })
  })

  it('creates error envelopes', () => {
    expect(err('forbidden', 'Trip access denied')).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Trip access denied' },
    })
  })
})
