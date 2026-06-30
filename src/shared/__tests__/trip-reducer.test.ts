import { applyTripEvent } from '../trip-reducer'
import type { TripDocument, TripEvent } from '../trip-types'

function acceptTripEvent(_event: TripEvent): void {}

function baseDoc(): TripDocument {
  return {
    id: 'trip_1',
    title: 'Test Trip',
    selectedPage: 'itinerary',
    selection: { type: 'activity', id: 'activity_1' },
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
    tasks: [],
  }
}

describe('applyTripEvent', () => {
  it('rejects mismatched entity event types at compile time', () => {
    // @ts-expect-error entityType task cannot create an expense entity
    acceptTripEvent({ id: 'event_type_1', tripId: 'trip_1', version: 1, previousVersion: 0, actorUserId: 'user_1', createdAt: '2026-07-01T00:00:00.000Z', type: 'entity.create', payload: { entityType: 'task', entity: { id: 'expense_1', type: 'expense', title: 'Pizza', payer: 'Shared', amount: 42, split: 'Equal split', allocationMode: 'equal', allocations: {}, settled: false } } })

    // @ts-expect-error update patches cannot change entity identity
    acceptTripEvent({ id: 'event_type_2', tripId: 'trip_1', version: 2, previousVersion: 1, actorUserId: 'user_1', createdAt: '2026-07-01T00:01:00.000Z', type: 'entity.update', payload: { entityType: 'task', id: 'task_1', patch: { id: 'task_2', type: 'expense' } } })

    // @ts-expect-error location update patches cannot change identity despite extra JSON fields
    acceptTripEvent({ id: 'event_type_3', tripId: 'trip_1', version: 3, previousVersion: 2, actorUserId: 'user_1', createdAt: '2026-07-01T00:02:00.000Z', type: 'entity.update', payload: { entityType: 'location', id: 'loc_1', patch: { id: 'loc_2', type: 'task' } } })
  })

  it('creates an entity in the matching collection', () => {
    const event: TripEvent = {
      id: 'event_1',
      tripId: 'trip_1',
      version: 1,
      previousVersion: 0,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:00:00.000Z',
      type: 'entity.create',
      payload: {
        entityType: 'task',
        entity: {
          id: 'task_1',
          type: 'task',
          title: 'Pack snacks',
          dayId: 'thu',
          status: 'open',
          linkedEntityKeys: [],
          note: '',
        },
      },
    }

    const next = applyTripEvent(baseDoc(), event)

    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]?.title).toBe('Pack snacks')
  })

  it('updates an existing entity', () => {
    const doc = baseDoc()
    doc.tasks = [{
      id: 'task_1',
      type: 'task',
      title: 'Pack snacks',
      dayId: 'thu',
      status: 'open',
      linkedEntityKeys: [],
      note: '',
    }]

    const event: TripEvent = {
      id: 'event_2',
      tripId: 'trip_1',
      version: 2,
      previousVersion: 1,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:01:00.000Z',
      type: 'entity.update',
      payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
    }

    expect(applyTripEvent(doc, event).tasks[0]?.status).toBe('done')
  })

  it('deletes an entity from the matching collection', () => {
    const doc = baseDoc()
    doc.expenses = [{
      id: 'expense_1',
      type: 'expense',
      title: 'Pizza',
      payer: 'Shared',
      amount: 42,
      split: 'Equal split',
      allocationMode: 'equal',
      allocations: {},
      settled: false,
      linkedEntityKeys: [],
      note: '',
    }]

    const event: TripEvent = {
      id: 'event_3',
      tripId: 'trip_1',
      version: 3,
      previousVersion: 2,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:02:00.000Z',
      type: 'entity.delete',
      payload: { entityType: 'expense', id: 'expense_1' },
    }

    expect(applyTripEvent(doc, event).expenses).toEqual([])
  })
})
