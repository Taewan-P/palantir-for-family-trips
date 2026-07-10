import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TripsPage } from '../TripsPage'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null
let originalFetch: typeof fetch
let originalConfirm: typeof window.confirm

describe('TripsPage', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalFetch = globalThis.fetch
    originalConfirm = window.confirm
    window.history.replaceState(null, '', '/trips')
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
    window.confirm = originalConfirm
  })

  it('redirects unauthenticated users to sign in with the current route preserved', async () => {
    globalThis.fetch = jsonFetch([
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
    ])

    await render()

    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?next=%2Ftrips')
  })

  it('opens the guided setup panel from the new trip action', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [] } },
    ])

    await render()
    const button = findButton('New trip')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(host?.querySelector('form')).not.toBeNull()
    expect(host?.querySelector('input[name="destinationName"]')).not.toBeNull()
    expect(host?.textContent).not.toContain('template')
  })

  it('posts guided setup payload and navigates to the created trip', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [] } },
      { ok: true, data: { trip: { id: 'trip_123', title: 'Tahoe', role: 'owner', currentVersion: 0 } } },
    ])

    await render()
    const button = findButton('New trip')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    setInputValue(input('title'), '  Tahoe command post  ')
    setInputValue(input('startDate'), '2026-07-10')
    setInputValue(input('endDate'), '2026-07-12')
    setInputValue(input('destinationName'), '  Lake Tahoe  ')
    setInputValue(input('basecampAddress'), '  100 Alpine Way  ')
    setInputValue(input('families.0.displayName'), '  Park Household  ')
    setInputValue(input('families.0.origin'), '  Seoul  ')
    setInputValue(input('families.0.adults'), '2')
    setInputValue(input('families.0.kids'), '1')

    await act(async () => {
      host?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    const postCall = fetchCalls()[1]
    expect(postCall?.[0]).toBe('/api/trips')
    expect(postCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      title: 'Tahoe command post',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Lake Tahoe',
      basecampAddress: '100 Alpine Way',
      families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
    })
    expect(window.location.pathname).toBe('/trips/trip_123')
  })

  it('archives owner trips from the list without opening the trip', async () => {
    window.confirm = vi.fn(() => true)
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [{ id: 'trip_1', title: 'Owner Trip', role: 'owner', updatedAt: '2026-07-01T00:00:00.000Z' }] } },
      { ok: true, data: { archived: true } },
    ])

    await render()
    expect(host?.textContent).toContain('Owner Trip')

    const archiveButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Archive'))

    await act(async () => {
      archiveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(window.location.pathname).toBe('/trips')
    expect(host?.textContent).not.toContain('Owner Trip')
    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/trips/trip_1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('does not show archive actions for editor trips', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [{ id: 'trip_1', title: 'Editor Trip', role: 'editor', updatedAt: '2026-07-01T00:00:00.000Z' }] } },
    ])

    await render()

    expect(host?.textContent).toContain('Editor Trip')
    expect(host?.textContent).not.toContain('Archive')
  })

  it('keeps guided input and shows create failures inside the setup form', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [] } },
      { ok: false, error: { code: 'bad_request', message: 'Destination is unavailable' } },
    ])

    await render()
    await act(async () => {
      findButton('New trip')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    setInputValue(input('title'), 'Retained trip')
    setInputValue(input('startDate'), '2026-07-10')
    setInputValue(input('endDate'), '2026-07-12')
    setInputValue(input('destinationName'), 'Tokyo')
    setInputValue(input('families.0.displayName'), 'Park Household')

    await act(async () => {
      host?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(host?.querySelector('form [role="alert"]')?.textContent).toContain('Destination is unavailable')
    expect(input('title')?.value).toBe('Retained trip')
  })

  it('signs out from the trip list', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { trips: [] } },
      { ok: true, data: { loggedOut: true } },
    ])

    await render()
    await act(async () => {
      findButton('Sign out')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(window.location.pathname).toBe('/login')
  })
})

async function render(): Promise<void> {
  await act(async () => {
    root?.render(<TripsPage />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function jsonFetch(payloads: unknown[]): typeof fetch {
  return vi.fn(async () => ({
    json: async () => payloads.shift(),
  })) as unknown as typeof fetch
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(host?.querySelectorAll('button') ?? [])
    .find((button) => button.textContent?.includes(text))
}

function input(name: string): HTMLInputElement | null {
  return host?.querySelector(`input[name="${name}"]`) ?? null
}

function setInputValue(inputElement: HTMLInputElement | null | undefined, value: string): void {
  if (!inputElement) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(inputElement, value)
  inputElement.dispatchEvent(new Event('input', { bubbles: true }))
}

function fetchCalls(): [unknown, RequestInit | undefined][] {
  return (globalThis.fetch as unknown as { mock: { calls: [unknown, RequestInit | undefined][] } }).mock.calls
}
