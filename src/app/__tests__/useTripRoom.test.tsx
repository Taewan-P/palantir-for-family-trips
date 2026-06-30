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
})

function tripDocument(): TripDocument {
  return {
    id: 'trip_123',
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
