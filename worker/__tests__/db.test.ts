import { claimActiveInvite, claimInviteAndCreateMembership, commitTripEvent, createTripWithOwnerAndInitialSnapshot, decodeTripEventRow, encodeTripEventPayload, findActiveInvite, findActiveShareLink, getTripAccess, loadHydratedTripSnapshot, rotateShareLink } from '../db'
import { replayTripEvents } from '../../src/shared/trip-reducer'
import type { TripDocument } from '../../src/shared/trip-types'

describe('db event codecs', () => {
  it('distinguishes missing trips from missing roles', async () => {
    await expect(getTripAccess(dbWithFirst(null), 'missing_trip', 'user_1')).resolves.toEqual({
      exists: false,
      role: null,
    })
    await expect(getTripAccess(dbWithFirst({ role: null }), 'trip_1', 'user_1')).resolves.toEqual({
      exists: true,
      role: null,
    })
    await expect(getTripAccess(dbWithFirst({ role: 'owner' }), 'trip_1', 'user_1')).resolves.toEqual({
      exists: true,
      role: 'owner',
    })
  })

  it('claims only an active unaccepted invite', async () => {
    const calls: unknown[][] = []
    const claimed = { id: 'invite_1', trip_id: 'trip_1', role: 'editor' }

    await expect(claimActiveInvite(dbWithFirst(claimed, calls), {
      tokenHash: 'token_hash',
      userId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })).resolves.toEqual(claimed)

    expect(calls).toEqual([['user_1', '2026-07-01T00:00:00.000Z', 'token_hash', '2026-07-01T00:00:00.000Z']])
  })

  it('returns no invite when the conditional claim finds no active row', async () => {
    await expect(claimActiveInvite(dbWithFirst(null), {
      tokenHash: 'token_hash',
      userId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })).resolves.toBeNull()
  })

  it('ignores invite tokens for archived trips', async () => {
    const sql: string[] = []
    const db = dbRecordingSql(sql)

    await findActiveInvite(db, 'token_hash', '2026-07-01T00:00:00.000Z')
    await claimActiveInvite(db, {
      tokenHash: 'token_hash',
      userId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(sql[0]).toContain('INNER JOIN trips ON trips.id = invites.trip_id AND trips.archived_at IS NULL')
    expect(sql[1]).toContain('WHERE trips.id = invites.trip_id AND trips.archived_at IS NULL')
  })

  it('ignores share tokens for archived trips', async () => {
    const sql: string[] = []
    const db = dbRecordingSql(sql)

    await findActiveShareLink(db, 'token_hash')

    expect(sql[0]).toContain('INNER JOIN trips ON trips.id = share_links.trip_id AND trips.archived_at IS NULL')
  })

  it('rotates sanitized share links in one D1 batch', async () => {
    const calls: unknown[][] = []
    const batched: unknown[] = []

    await rotateShareLink(dbWithBatch(calls, batched), {
      id: 'share_2',
      tripId: 'trip_1',
      tokenHash: 'token_hash',
      createdByUserId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(calls).toEqual([
      ['2026-07-01T00:00:00.000Z', 'trip_1'],
      ['share_2', 'trip_1', 'token_hash', 'user_1', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
    ])
    expect(batched).toHaveLength(2)
  })

  it('creates a trip, owner membership, initial snapshot, and latest snapshot pointer in one D1 batch', async () => {
    const calls: unknown[][] = []
    const batched: unknown[] = []
    const document = baseDoc()

    await createTripWithOwnerAndInitialSnapshot(dbWithBatch(calls, batched), {
      tripId: 'trip_1',
      title: 'Trip',
      slug: 'trip-trip_1',
      ownerUserId: 'user_1',
      snapshotId: 'snapshot_1',
      document,
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(calls).toEqual([
      ['trip_1', 'Trip', 'trip-trip_1', 'user_1', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
      ['trip_1', 'user_1', 'owner', '2026-07-01T00:00:00.000Z'],
      ['snapshot_1', 'trip_1', 0, JSON.stringify(document), 'user_1', '2026-07-01T00:00:00.000Z'],
      ['snapshot_1', 'trip_1'],
    ])
    expect(batched).toHaveLength(4)
  })

  it('claims an active invite and creates editor membership in one D1 batch', async () => {
    const calls: unknown[][] = []
    const batched: unknown[] = []
    const claimed = { id: 'invite_1', trip_id: 'trip_1', role: 'editor' }

    await expect(claimInviteAndCreateMembership(dbWithBatch(calls, batched, [
      { results: [claimed] },
      { meta: { changes: 1 } },
    ]), {
      tokenHash: 'token_hash',
      userId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })).resolves.toEqual(claimed)

    expect(calls).toEqual([
      ['user_1', '2026-07-01T00:00:00.000Z', 'token_hash', '2026-07-01T00:00:00.000Z'],
      ['user_1', '2026-07-01T00:00:00.000Z', 'token_hash', 'user_1', '2026-07-01T00:00:00.000Z'],
    ])
    expect(batched).toHaveLength(2)
  })

  it('returns no invite when the atomic invite claim does not update a row', async () => {
    await expect(claimInviteAndCreateMembership(dbWithBatch([], [], [
      { results: [] },
      { meta: { changes: 0 } },
    ]), {
      tokenHash: 'token_hash',
      userId: 'user_1',
      now: '2026-07-01T00:00:00.000Z',
    })).resolves.toBeNull()
  })

  it('commits accepted events and snapshots in one D1 batch', async () => {
    const calls: unknown[][] = []
    const batched: unknown[] = []
    const document = baseDoc()

    await commitTripEvent(dbWithBatch(calls, batched), {
      event: {
        id: 'event_25',
        tripId: 'trip_1',
        version: 25,
        previousVersion: 24,
        actorUserId: 'user_1',
        createdAt: '2026-07-01T00:00:00.000Z',
        type: 'entity.update',
        payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
      },
      updatedAt: '2026-07-01T00:00:01.000Z',
      snapshot: { id: 'snapshot_25', document, userId: 'user_1' },
    })

    expect(calls).toEqual([
      ['event_25', 'trip_1', 25, 24, 'user_1', 'entity.update', '{"entityType":"task","id":"task_1","patch":{"status":"done"}}', '2026-07-01T00:00:00.000Z'],
      [25, '2026-07-01T00:00:01.000Z', 'trip_1'],
      ['snapshot_25', 'trip_1', 25, JSON.stringify(document), 'user_1', '2026-07-01T00:00:00.000Z'],
      ['snapshot_25', 'trip_1'],
    ])
    expect(batched).toHaveLength(4)
  })

  it('commits accepted events without snapshots in one D1 batch', async () => {
    const calls: unknown[][] = []
    const batched: unknown[] = []

    await commitTripEvent(dbWithBatch(calls, batched), {
      event: {
        id: 'event_1',
        tripId: 'trip_1',
        version: 1,
        previousVersion: 0,
        actorUserId: 'user_1',
        createdAt: '2026-07-01T00:00:00.000Z',
        type: 'uiState.update',
        payload: { searchQuery: 'lunch' },
      },
      updatedAt: '2026-07-01T00:00:01.000Z',
    })

    expect(calls).toEqual([
      ['event_1', 'trip_1', 1, 0, 'user_1', 'uiState.update', '{"searchQuery":"lunch"}', '2026-07-01T00:00:00.000Z'],
      [1, '2026-07-01T00:00:01.000Z', 'trip_1'],
    ])
    expect(batched).toHaveLength(2)
  })

  it('hydrates the latest snapshot with later events', async () => {
    const calls: unknown[][] = []
    const db = dbWithResults([
      { first: { version: 3, document_json: JSON.stringify(baseDoc()) } },
      {
        all: [{
          id: 'event_4',
          trip_id: 'trip_1',
          version: 4,
          previous_version: 3,
          actor_user_id: null,
          type: 'entity.update',
          payload_json: '{"entityType":"task","id":"task_1","patch":{"status":"done"}}',
          created_at: '2026-07-01T00:00:00.000Z',
        }],
      },
    ], calls)

    await expect(loadHydratedTripSnapshot(db, 'trip_1')).resolves.toMatchObject({
      tasks: [{ id: 'task_1', status: 'done' }],
    })
    expect(calls).toEqual([['trip_1'], ['trip_1', 3]])
  })

  it('encodes and decodes trip event payloads', () => {
    const payload = { entityType: 'task', id: 'task_1' }
    const encoded = encodeTripEventPayload(payload)
    expect(encoded).toBe('{"entityType":"task","id":"task_1"}')

    const decoded = decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'entity.delete',
      payload_json: encoded,
      created_at: '2026-07-01T00:00:00.000Z',
    })

    expect(decoded.payload).toEqual(payload)
    expect(decoded.type).toBe('entity.delete')
  })

  it('decodes and replays persisted trip events without an actor user', () => {
    const decoded = decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: null,
      type: 'entity.delete',
      payload_json: '{"entityType":"task","id":"task_1"}',
      created_at: '2026-07-01T00:00:00.000Z',
    })

    expect(decoded.actorUserId).toBeNull()
    expect(replayTripEvents(baseDoc(), [decoded]).tasks).toEqual([])
  })

  it('rejects malformed persisted event payloads', () => {
    expect(() => decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'entity.delete',
      payload_json: 'null',
      created_at: '2026-07-01T00:00:00.000Z',
    })).toThrow('Trip event event_1 payload must be a JSON object')
  })

  it('rejects mismatched entity create payloads', () => {
    expect(() => decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'entity.create',
      payload_json: '{"entityType":"task","entity":{"type":"expense","id":"task_1"}}',
      created_at: '2026-07-01T00:00:00.000Z',
    })).toThrow('Trip event event_1 payload does not match entity.create')
  })

  it('rejects malformed entity create payloads', () => {
    for (const { entityType, entity } of [
      { entityType: 'task', entity: '{"id":"task_1","type":"task"}' },
      {
        entityType: 'expense',
        entity: '{"id":"expense_1","type":"expense","title":"Dinner","payer":"Shared","amount":"42","split":"Equal","allocationMode":"equal","allocations":{},"settled":false}',
      },
    ]) {
      expect(() => decodeTripEventRow({
        id: 'event_1',
        trip_id: 'trip_1',
        version: 1,
        previous_version: 0,
        actor_user_id: 'user_1',
        type: 'entity.create',
        payload_json: `{"entityType":"${entityType}","entity":${entity}}`,
        created_at: '2026-07-01T00:00:00.000Z',
      })).toThrow('Trip event event_1 payload does not match entity.create')
    }
  })

  it('rejects unsupported persisted event types', () => {
    expect(() => decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'entity.rename',
      payload_json: '{"entityType":"task","id":"task_1"}',
      created_at: '2026-07-01T00:00:00.000Z',
    })).toThrow('Trip event event_1 has unsupported type entity.rename')
  })

  it('rejects entity update patches that overwrite immutable keys', () => {
    for (const patch of ['{"id":"other"}', '{"type":"expense"}']) {
      expect(() => decodeTripEventRow({
        id: 'event_1',
        trip_id: 'trip_1',
        version: 1,
        previous_version: 0,
        actor_user_id: 'user_1',
        type: 'entity.update',
        payload_json: `{"entityType":"task","id":"task_1","patch":${patch}}`,
        created_at: '2026-07-01T00:00:00.000Z',
      })).toThrow('Trip event event_1 payload does not match entity.update')
    }
  })

  it('rejects malformed entity update patches', () => {
    for (const { entityType, patch } of [
      { entityType: 'task', patch: '{"status":false}' },
      { entityType: 'expense', patch: '{"amount":"42"}' },
      { entityType: 'task', patch: '{"mystery":true}' },
      { entityType: 'location', patch: '{"privateDoorCode":"4455"}' },
    ]) {
      expect(() => decodeTripEventRow({
        id: 'event_1',
        trip_id: 'trip_1',
        version: 1,
        previous_version: 0,
        actor_user_id: 'user_1',
        type: 'entity.update',
        payload_json: `{"entityType":"${entityType}","id":"task_1","patch":${patch}}`,
        created_at: '2026-07-01T00:00:00.000Z',
      })).toThrow('Trip event event_1 payload does not match entity.update')
    }
  })

  it('accepts day, family assignment, stay access, and route origin patches', () => {
    for (const { entityType, id, patch } of [
      { entityType: 'day', id: 'day_1', patch: { title: 'Arrival day', date: '2026-07-11', note: 'Meet at noon' } },
      { entityType: 'family', id: 'family_1', patch: { adults: 3, kids: 1, assignedUserId: 'user_2', assignedUserEmail: 'editor@example.com' } },
      { entityType: 'stayItem', id: 'stay_1', patch: { address: '1 Basecamp Way', accessNote: 'Gate 2', parkingNote: 'Driveway' } },
      { entityType: 'route', id: 'route_1', patch: { origin: 'Seoul Station', stopLocationIds: ['loc_1'] } },
    ]) {
      expect(() => decodeTripEventRow({
        id: `event_${entityType}`,
        trip_id: 'trip_1',
        version: 1,
        previous_version: 0,
        actor_user_id: 'user_1',
        type: 'entity.update',
        payload_json: JSON.stringify({ entityType, id, patch }),
        created_at: '2026-07-01T00:00:00.000Z',
      })).not.toThrow()
    }
  })

  it('rejects malformed ui state update payloads', () => {
    for (const payload of [
      '{"searchQuery":1}',
      '{"timeline":{"mode":"plan","cursorSlot":"soon"}}',
      '{"map":{"showRoutes":"yes"}}',
    ]) {
      expect(() => decodeTripEventRow({
        id: 'event_1',
        trip_id: 'trip_1',
        version: 1,
        previous_version: 0,
        actor_user_id: 'user_1',
        type: 'uiState.update',
        payload_json: payload,
        created_at: '2026-07-01T00:00:00.000Z',
      })).toThrow('Trip event event_1 payload does not match uiState.update')
    }
  })

  it('decodes partial ui state update payloads', () => {
    const decoded = decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'uiState.update',
      payload_json: '{"timeline":{"cursorSlot":3},"map":{"showTraffic":true,"focusDayId":"day_2"}}',
      created_at: '2026-07-01T00:00:00.000Z',
    })

    expect(decoded.payload).toEqual({
      timeline: { cursorSlot: 3 },
      map: { showTraffic: true, focusDayId: 'day_2' },
    })
  })
})

function baseDoc(): TripDocument {
  return {
    id: 'trip_1',
    title: 'Trip',
    selectedPage: 'overview',
    selection: { type: 'task', id: 'task_1' },
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      searchQuery: '',
      timeline: { mode: 'scenario', cursorSlot: 0 },
      map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
    },
    families: [],
    locations: [],
    routes: [],
    itineraryItems: [],
    meals: [],
    activities: [],
    stayItems: [],
    expenses: [],
    tasks: [{ id: 'task_1', type: 'task', title: 'Pack', status: 'open' }],
  }
}

function dbWithFirst(row: unknown, calls?: unknown[][]): D1Database {
  return dbWithResults([{ first: row }], calls)
}

function dbWithResults(results: Array<{ first?: unknown; all?: unknown[] }>, calls: unknown[][] = []): D1Database {
  let index = 0
  return {
    prepare() {
      const result = results[index++]
      return {
        bind(...args: unknown[]) {
          calls.push(args)
          return {
            first: async () => result.first,
            all: async () => ({ results: result.all ?? [] }),
          }
        },
      }
    },
  } as unknown as D1Database
}

function dbWithBatch(calls: unknown[][], batched: unknown[], results: unknown[] = []): D1Database {
  return {
    prepare() {
      return {
        bind(...args: unknown[]) {
          calls.push(args)
          const statement = { args }
          return statement
        },
      }
    },
    async batch(statements: unknown[]) {
      batched.push(...statements)
      return results
    },
  } as unknown as D1Database
}

function dbRecordingSql(sql: string[]): D1Database {
  return {
    prepare(statement: string) {
      sql.push(statement)
      return {
        bind() {
          return {
            first: async () => null,
          }
        },
      }
    },
  } as unknown as D1Database
}
