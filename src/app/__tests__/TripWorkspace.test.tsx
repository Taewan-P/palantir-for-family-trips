import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTripFromTemplate } from '../../shared/trip-template'
import { TripWorkspace } from '../TripWorkspace'

vi.mock('../../App', () => ({
  default: ({ serviceTripId, initialServiceDocument, tripRole, serviceTripMembers, viewerUserId }: { serviceTripId: string; initialServiceDocument: { title: string }; tripRole?: string; serviceTripMembers?: { name: string }[]; viewerUserId?: string }) => (
    <div data-testid="workspace">
      {serviceTripId} / {initialServiceDocument.title} / {tripRole} / {serviceTripMembers?.[0]?.name} / {viewerUserId}
    </div>
  ),
}))

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null
let originalFetch: typeof fetch

describe('TripWorkspace', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalFetch = globalThis.fetch
    window.history.replaceState(null, '', '/trips/trip_123')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    globalThis.fetch = originalFetch
  })

  it('redirects unauthenticated trip loads to sign in without rendering the workspace', async () => {
    globalThis.fetch = jsonFetch([
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
    ])

    await render(<TripWorkspace tripId="trip_123" />)

    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?next=%2Ftrips%2Ftrip_123')
    expect(host?.textContent).not.toContain('trip_123')
  })

  it('renders the fetched member trip document', async () => {
    globalThis.fetch = jsonFetch([
      {
        ok: true,
        data: {
          trip: createTripFromTemplate({ id: 'trip_123', title: 'Member Trip' }),
          role: 'editor',
          version: 0,
          members: [{ userId: 'user_1', email: 'editor@example.com', name: 'Editor User', avatarUrl: null, role: 'editor', createdAt: '2026-07-01T00:00:00.000Z' }],
        },
      },
      { ok: true, data: { user: { id: 'user_1', email: 'editor@example.com', name: 'Editor User', avatarUrl: null } } },
    ])

    await render(<TripWorkspace tripId="trip_123" />)

    expect(host?.textContent).toContain('trip_123 / Member Trip / editor / Editor User / user_1')
  })
})

async function render(element: React.ReactNode): Promise<void> {
  await act(async () => {
    root?.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function jsonFetch(payloads: unknown[]): typeof fetch {
  return vi.fn(async () => ({
    json: async () => payloads.shift(),
  })) as unknown as typeof fetch
}
