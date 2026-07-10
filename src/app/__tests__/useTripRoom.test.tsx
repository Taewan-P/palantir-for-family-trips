import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TripDocument } from '../../shared/trip-types'
import { useTripRoom, type TripRoomState } from '../useTripRoom'

type SocketEventName = 'open' | 'close' | 'error' | 'message'
type SocketListener = (event: Event) => void

const sockets: MockWebSocket[] = []
let originalWebSocket: typeof WebSocket
let root: Root | null = null
let host: HTMLDivElement | null = null
let latestState: TripRoomState | null = null
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

class MockWebSocket {
  static readonly OPEN = 1

  readonly sent: string[] = []
  readyState = MockWebSocket.OPEN
  private readonly listeners: Partial<Record<SocketEventName, SocketListener[]>> = {}

  constructor(readonly url: string) {
    sockets.push(this)
  }

  addEventListener(type: SocketEventName, listener: SocketListener): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener]
  }

  close(): void {
    this.readyState = 3
    this.dispatch('close', new Event('close'))
  }

  send(value: string): void {
    this.sent.push(value)
  }

  dispatch(type: SocketEventName, event: Event): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }
}

function Probe({ tripId }: { tripId: string }) {
  latestState = useTripRoom(tripId)
  return null
}

describe('useTripRoom', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalWebSocket = globalThis.WebSocket
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: MockWebSocket,
    })
    sockets.length = 0
    latestState = null
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    })
  })

  it('opens the trip socket and handles snapshot messages', () => {
    act(() => root?.render(<Probe tripId="trip_123" />))

    expect(sockets[0].url).toMatch(/^ws/)
    expect(sockets[0].url).toMatch(/\/api\/trips\/trip_123\/live$/)

    act(() => sockets[0].dispatch('open', new Event('open')))
    expect(latestState?.status).toBe('open')

    const document = tripDocument()
    act(() =>
      sockets[0].dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document, version: 7 }) }),
      ),
    )

    expect(latestState?.document).toEqual(document)
    expect(latestState?.version).toBe(7)
  })

  it('marks malformed messages as errors without throwing', () => {
    act(() => root?.render(<Probe tripId="trip_123" />))

    expect(() => {
      act(() => sockets[0].dispatch('message', new MessageEvent('message', { data: '{' })))
    }).not.toThrow()
    expect(latestState?.status).toBe('error')
  })

  it('repairs legacy public-share copy from member room snapshots', () => {
    act(() => root?.render(<Probe tripId="trip_123" />))
    const document = tripDocument()
    document.locations.push({
      id: 'pine-airbnb',
      type: 'location',
      title: 'Pine Mountain Lake Basecamp',
      category: 'stay',
      accessNote: 'Arrival and access details are intentionally redacted in the public version.',
    })

    act(() =>
      sockets[0].dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document, version: 1 }) }),
      ),
    )

    expect(latestState?.document?.locations[0]?.accessNote).toBe(
      'Confirm community access, guest passes, and the arrival handoff before departure.',
    )
  })

  it('ignores stale events from a previous trip socket', () => {
    act(() => root?.render(<Probe tripId="trip_1" />))
    const previousSocket = sockets[0]
    const previousDocument = tripDocument('trip_1')

    act(() => previousSocket.dispatch('open', new Event('open')))
    act(() =>
      previousSocket.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document: previousDocument, version: 1 }) }),
      ),
    )
    expect(latestState?.document?.id).toBe('trip_1')

    act(() => root?.render(<Probe tripId="trip_2" />))
    const currentSocket = sockets[1]
    const currentDocument = tripDocument('trip_2')

    act(() => currentSocket.dispatch('open', new Event('open')))
    act(() =>
      currentSocket.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document: currentDocument, version: 2 }) }),
      ),
    )

    act(() => previousSocket.dispatch('close', new Event('close')))
    act(() =>
      previousSocket.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document: previousDocument, version: 99 }) }),
      ),
    )

    expect(latestState?.status).toBe('open')
    expect(latestState?.document?.id).toBe('trip_2')
    expect(latestState?.version).toBe(2)
  })

  it('serializes commands with the latest accepted room version', () => {
    act(() => root?.render(<Probe tripId="trip_123" />))
    const socket = sockets[0]
    const document = tripDocument()

    act(() => socket.dispatch('open', new Event('open')))
    act(() =>
      socket.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document, version: 7 }) }),
      ),
    )

    act(() => {
      latestState?.sendCommand({ id: 'cmd_1', baseVersion: 0, type: 'uiState.update', payload: { searchQuery: 'l' } })
      latestState?.sendCommand({ id: 'cmd_2', baseVersion: 0, type: 'uiState.update', payload: { searchQuery: 'la' } })
    })

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ id: 'cmd_1', baseVersion: 7 })

    act(() =>
      socket.dispatch(
        'message',
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'event.accepted',
            commandId: 'cmd_1',
            version: 8,
            event: tripEvent('uiState.update', { searchQuery: 'l' }, 8),
          }),
        }),
      ),
    )

    expect(socket.sent).toHaveLength(2)
    expect(JSON.parse(socket.sent[1] ?? '{}')).toMatchObject({ id: 'cmd_2', baseVersion: 8 })
  })

  it('drops a stale in-flight command after applying the current room snapshot', () => {
    act(() => root?.render(<Probe tripId="trip_123" />))
    const socket = sockets[0]
    const document = tripDocument()
    const serverDocument = tripDocument()
    serverDocument.ui.searchQuery = 'other editor'

    act(() => socket.dispatch('open', new Event('open')))
    act(() =>
      socket.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', document, version: 7 }) }),
      ),
    )

    act(() => {
      latestState?.sendCommand({ id: 'cmd_1', baseVersion: 0, type: 'uiState.update', payload: { searchQuery: 'mine' } })
    })
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ id: 'cmd_1', baseVersion: 7 })

    act(() =>
      socket.dispatch(
        'message',
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'event.rejected', reason: 'stale_version', document: serverDocument, version: 8 }),
        }),
      ),
    )

    expect(latestState?.document?.ui.searchQuery).toBe('other editor')
    expect(latestState?.version).toBe(8)
    expect(socket.sent).toHaveLength(1)

    act(() => {
      latestState?.sendCommand({ id: 'cmd_2', baseVersion: 0, type: 'uiState.update', payload: { searchQuery: 'explicit' } })
    })

    expect(socket.sent).toHaveLength(2)
    expect(JSON.parse(socket.sent[1] ?? '{}')).toMatchObject({ id: 'cmd_2', baseVersion: 8 })
  })
})

function tripEvent(type: 'uiState.update', payload: { searchQuery: string }, version: number) {
  return {
    id: `event_${version}`,
    tripId: 'trip_123',
    version,
    previousVersion: version - 1,
    actorUserId: 'user_1',
    createdAt: '2026-07-01T00:00:00.000Z',
    type,
    payload,
  }
}

function tripDocument(id = 'trip_123'): TripDocument {
  return {
    id,
    title: 'Trip',
    selectedPage: 'overview',
    selection: { type: 'family', id: 'family_1' },
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      searchQuery: '',
      timeline: { mode: 'day', cursorSlot: 0 },
      map: {
        showRoutes: true,
        showFacilities: false,
        showTraffic: false,
        focusFamilyId: 'family_1',
        focusDayId: 'day_1',
      },
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
