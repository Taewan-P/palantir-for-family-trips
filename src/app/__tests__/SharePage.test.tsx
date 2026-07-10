import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTripFromTemplate } from '../../shared/trip-template'
import { SharePage } from '../SharePage'

vi.mock('../TripWorkspace', () => ({
  TripWorkspace: ({ initialDocument, readOnly }: { initialDocument: { title: string }; readOnly: boolean }) => (
    <div data-testid="workspace">
      {initialDocument.title} / {readOnly ? 'read-only' : 'editable'}
    </div>
  ),
}))

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null
let originalFetch: typeof fetch

describe('SharePage', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalFetch = globalThis.fetch
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

  it('renders the shared trip returned by the Worker API as read-only', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        data: {
          trip: createTripFromTemplate({ id: 'trip_123', title: 'Shared Trip' }),
          readOnly: true,
        },
      }),
    })) as unknown as typeof fetch

    await act(async () => {
      root?.render(<SharePage token="share_token" />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Shared Trip')
    expect(host?.textContent).toContain('read-only')
  })
})
