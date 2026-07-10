import { jsonError, jsonOk, parseCookie, redirect } from '../http'

describe('http helpers', () => {
  it('serializes success JSON', async () => {
    const response = jsonOk({ id: 'trip_1' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, data: { id: 'trip_1' } })
  })

  it('keeps JSON content type over caller headers', () => {
    const response = jsonOk({ id: 'trip_1' }, { headers: { 'content-type': 'text/plain' } })
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it('serializes error JSON', async () => {
    const response = jsonError(403, 'forbidden', 'Trip access denied')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Trip access denied' },
    })
  })

  it('parses cookies', () => {
    expect(parseCookie('a=1; trip_session=abc; b=2', 'trip_session')).toBe('abc')
  })

  it('returns null for malformed cookie encoding', () => {
    expect(parseCookie('trip_session=%', 'trip_session')).toBeNull()
  })

  it('keeps the intended redirect location over caller headers', () => {
    const response = redirect('https://app.example.com/next', new Headers([
      ['location', 'https://evil.example.com/'],
      ['x-test', '1'],
    ]))

    expect(response.headers.get('location')).toBe('https://app.example.com/next')
    expect(response.headers.get('x-test')).toBe('1')
  })
})
