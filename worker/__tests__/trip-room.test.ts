import { acceptCommand, type TripCommand } from '../trip-room'
import type { TripDocument } from '../../src/shared/trip-types'

describe('acceptCommand', () => {
  it('rejects stale base versions', () => {
    const result = acceptCommand({
      tripId: 'trip_1',
      actorUserId: 'user_1',
      document: baseDoc(),
      version: 2,
      now: '2026-07-01T00:00:00.000Z',
      command: {
        id: 'cmd_1',
        baseVersion: 1,
        type: 'entity.update',
        payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
      },
    })

    expect(result).toEqual({ ok: false, reason: 'stale_version' })
  })

  it('creates the next event and applies it to the document', () => {
    const result = acceptCommand({
      tripId: 'trip_1',
      actorUserId: 'user_1',
      document: baseDoc(),
      version: 2,
      now: '2026-07-01T00:00:00.000Z',
      command: updateTaskCommand(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected accepted command')
    expect(result.event).toMatchObject({
      tripId: 'trip_1',
      version: 3,
      previousVersion: 2,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:00:00.000Z',
      type: 'entity.update',
      payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
    })
    expect(result.event.id).toMatch(/^event_/)
    expect(result.document.tasks[0]?.status).toBe('done')
  })
})

function updateTaskCommand(): TripCommand {
  return {
    id: 'cmd_1',
    baseVersion: 2,
    type: 'entity.update',
    payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
  }
}

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
