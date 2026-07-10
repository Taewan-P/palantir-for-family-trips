import { acceptCommand, parseTripCommand, TripRoom, type TripCommand } from '../trip-room'
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

describe('parseTripCommand', () => {
  it('rejects entity update payloads that persisted event hydration rejects', () => {
    expect(parseTripCommand(JSON.stringify({
      id: 'cmd_1',
      baseVersion: 2,
      type: 'entity.update',
      payload: { entityType: 'task', id: 'task_1', patch: { status: false } },
    }))).toBeNull()
  })

  it('rejects malformed ui state payloads that persisted event hydration rejects', () => {
    for (const payload of [
      { searchQuery: 1 },
      { timeline: { mode: 'plan', cursorSlot: 'soon' } },
      { map: { showRoutes: 'yes' } },
    ]) {
      expect(parseTripCommand(JSON.stringify({
        id: 'cmd_1',
        baseVersion: 2,
        type: 'uiState.update',
        payload,
      }))).toBeNull()
    }
  })
})

describe('TripRoom command handling', () => {
  it('rejects malformed commands before accepting or persisting', async () => {
    const db = {
      batch: vi.fn(async () => {
        throw new Error('invalid command reached persistence')
      }),
    }
    const room = new TripRoom({} as DurableObjectState, { DB: db } as never)
    const sent: unknown[] = []
    const socket = {
      send: vi.fn((message: string) => sent.push(JSON.parse(message))),
    } as unknown as WebSocket

    ;(room as unknown as { document: TripDocument; version: number }).document = baseDoc()
    ;(room as unknown as { document: TripDocument; version: number }).version = 2

    await (room as unknown as {
      handleMessage(socket: WebSocket, tripId: string, actorUserId: string, data: unknown): Promise<void>
    }).handleMessage(socket, 'trip_1', 'user_1', JSON.stringify({
      id: 'cmd_1',
      baseVersion: 2,
      type: 'entity.update',
      payload: { entityType: 'task', id: 'task_1', patch: { status: false } },
    }))

    expect(sent).toEqual([{ type: 'event.rejected', reason: 'malformed_command' }])
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('rechecks trip access before accepting a live edit command', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ role: null })),
        })),
      })),
      batch: vi.fn(async () => {
        throw new Error('forbidden command reached persistence')
      }),
    }
    const room = new TripRoom({} as DurableObjectState, { DB: db } as never)
    const sent: unknown[] = []
    const socket = {
      send: vi.fn((message: string) => sent.push(JSON.parse(message))),
    } as unknown as WebSocket

    ;(room as unknown as { document: TripDocument; version: number }).document = baseDoc()
    ;(room as unknown as { document: TripDocument; version: number }).version = 2

    await (room as unknown as {
      handleMessage(socket: WebSocket, tripId: string, actorUserId: string, data: unknown): Promise<void>
    }).handleMessage(socket, 'trip_1', 'user_1', JSON.stringify(updateTaskCommand()))

    expect(sent).toEqual([{ type: 'event.rejected', reason: 'forbidden' }])
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('rejects family account assignment from an editor member', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ role: 'editor' })),
        })),
      })),
      batch: vi.fn(async () => {
        throw new Error('editor assignment reached persistence')
      }),
    }
    const room = new TripRoom({} as DurableObjectState, { DB: db } as never)
    const sent: unknown[] = []
    const socket = {
      send: vi.fn((message: string) => sent.push(JSON.parse(message))),
    } as unknown as WebSocket

    ;(room as unknown as { document: TripDocument; version: number }).document = baseDoc()
    ;(room as unknown as { document: TripDocument; version: number }).version = 2

    await (room as unknown as {
      handleMessage(socket: WebSocket, tripId: string, actorUserId: string, data: unknown): Promise<void>
    }).handleMessage(socket, 'trip_1', 'user_editor', JSON.stringify({
      id: 'cmd_assign',
      baseVersion: 2,
      type: 'entity.update',
      payload: {
        entityType: 'family',
        id: 'family_1',
        patch: { assignedUserId: 'user_2', assignedUserEmail: 'member@example.com' },
      },
    }))

    expect(sent).toEqual([{ type: 'event.rejected', reason: 'forbidden' }])
    expect(db.batch).not.toHaveBeenCalled()
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
    families: [{ id: 'family_1', type: 'family', title: 'Family' }],
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
