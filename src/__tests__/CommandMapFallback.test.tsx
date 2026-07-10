import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CommandMap from '../CommandMap'
import type { Coordinates, TripDocument } from '../shared/trip-types'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

describe('CommandMap missing-key fallback', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    host.style.height = '720px'
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('renders an operational route board when Google Maps is unavailable', async () => {
    await act(async () => {
      root?.render(
        <CommandMap
          locations={[
            { id: 'basecamp', type: 'location', title: 'Basecamp', category: 'logistics', coordinates: { lat: 37.85, lng: -120.2 } },
            { id: 'yosemite', type: 'location', title: 'Yosemite Gate', category: 'park', coordinates: { lat: 37.73, lng: -119.63 } },
          ]}
          routes={[
            {
              id: 'route_1',
              type: 'route',
              title: 'Parkers inbound',
              familyId: 'family_1',
              originCoordinates: { lat: 34.05, lng: -118.24 },
              destinationLocationId: 'basecamp',
              path: [{ lat: 34.05, lng: -118.24 }, { lat: 37.85, lng: -120.2 }],
            },
          ]}
          families={[{ id: 'family_1', type: 'family', title: 'Parkers' }]}
          mapUi={emptyMapUi()}
          mapWeather={null}
          onUpdateMapUi={vi.fn()}
          onSelectEntity={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Offline route board')
    expect(host?.textContent).toContain('Parkers inbound')
    expect(host?.textContent).toContain('Basecamp')
  })

  it('skips invalid persisted route coordinates instead of crashing', async () => {
    await act(async () => {
      root?.render(
        <CommandMap
          locations={[
            { id: 'basecamp', type: 'location', title: 'Basecamp', category: 'logistics', coordinates: { lat: 37.85, lng: -120.2 } },
          ]}
          routes={[
            {
              id: 'route_1',
              type: 'route',
              title: 'Parkers inbound',
              familyId: 'family_1',
              destinationLocationId: 'basecamp',
              path: [
                { lat: 34.05, lng: -118.24 },
                undefined as unknown as Coordinates,
                { lat: 37.85, lng: -120.2 },
              ],
            },
          ]}
          families={[{ id: 'family_1', type: 'family', title: 'Parkers' }]}
          mapUi={emptyMapUi()}
          mapWeather={null}
          onUpdateMapUi={vi.fn()}
          onSelectEntity={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Offline route board')
    expect(host?.textContent).toContain('Parkers inbound')
    expect(host?.textContent).toContain('Basecamp')
  })

  it('renders the empty offline board when visible locations have no coordinates', async () => {
    await act(async () => {
      root?.render(
        <CommandMap
          locations={[{ id: 'location_destination', type: 'location', title: 'Tokyo', category: 'destination' }]}
          routes={[]}
          families={[]}
          mapUi={emptyMapUi()}
          mapWeather={null}
          onUpdateMapUi={vi.fn()}
          onSelectEntity={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Offline route board')
    expect(host?.textContent).toContain('No mapped coordinates available')
  })
})

function emptyMapUi(): TripDocument['ui']['map'] {
  return {
    showRoutes: true,
    showFacilities: true,
    showTraffic: false,
    focusFamilyId: 'all',
    focusDayId: 'all',
  }
}
