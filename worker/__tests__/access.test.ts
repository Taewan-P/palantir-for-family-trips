import { canManageAccess, canWriteTrip } from '../index'

describe('trip access helpers', () => {
  it('allows owners to manage access and write', () => {
    expect(canManageAccess('owner')).toBe(true)
    expect(canWriteTrip('owner')).toBe(true)
  })

  it('allows editors to write but not manage access', () => {
    expect(canManageAccess('editor')).toBe(false)
    expect(canWriteTrip('editor')).toBe(true)
  })

  it('denies missing roles', () => {
    expect(canManageAccess(null)).toBe(false)
    expect(canWriteTrip(null)).toBe(false)
  })
})
