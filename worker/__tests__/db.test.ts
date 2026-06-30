import { decodeTripEventRow, encodeTripEventPayload } from '../db'
import { replayTripEvents } from '../../src/shared/trip-reducer'
import type { TripDocument } from '../../src/shared/trip-types'

describe('db event codecs', () => {
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
