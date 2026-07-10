import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvitePage } from '../InvitePage'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null
let originalFetch: typeof fetch

describe('InvitePage', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalFetch = globalThis.fetch
    window.history.replaceState(null, '', '/invites/invite_token')
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

  it('accepts an invite and navigates to the joined trip', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ ok: true, data: { tripId: 'trip_123', role: 'editor' } }),
    })) as unknown as typeof fetch

    await render()

    expect(window.location.pathname).toBe('/trips/trip_123')
  })

  it('offers Google sign-in when accepting the invite requires authentication', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }),
    })) as unknown as typeof fetch

    await render()

    const link = host?.querySelector('a')
    expect(host?.textContent).toContain('Sign in required')
    expect(link?.textContent).toContain('Continue with Google')
    expect(link?.getAttribute('href')).toBe('/api/auth/google/start?next=%2Finvites%2Finvite_token')
  })
})

async function render(): Promise<void> {
  await act(async () => {
    root?.render(<InvitePage token="invite_token" />)
    await Promise.resolve()
    await Promise.resolve()
  })
}
