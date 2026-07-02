import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TripSettingsPanel } from '../TripSettingsPanel'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null
let originalFetch: typeof fetch
let originalClipboard: Clipboard | undefined
const members = [
  {
    userId: 'user_1',
    email: 'owner@example.com',
    name: 'Owner User',
    avatarUrl: null,
    role: 'owner' as const,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
]

describe('TripSettingsPanel', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    originalFetch = globalThis.fetch
    originalClipboard = navigator.clipboard
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
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  })

  it('disables owner-only access actions for editors', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    await act(async () => {
      root?.render(<TripSettingsPanel tripId="trip_123" title="Lake Trip" role="editor" members={members} readOnly={false} onRename={vi.fn()} />)
      await Promise.resolve()
    })

    const buttons = Array.from(host?.querySelectorAll('button') ?? [])
    const accessButtons = buttons.filter((button) => button.textContent?.includes('Create'))
    expect(accessButtons.map((button) => button.textContent?.trim())).toEqual([
      'Create invite link',
      'Create sanitized share',
    ])
    expect(accessButtons.every((button) => button.disabled)).toBe(true)

    await act(async () => {
      accessButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(host?.textContent).toContain('Owner access required')
  })

  it('renders trip members in settings', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    await act(async () => {
      root?.render(<TripSettingsPanel tripId="trip_123" title="Lake Trip" role="owner" members={members} readOnly={false} onRename={vi.fn()} />)
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Members')
    expect(host?.textContent).toContain('Owner User')
    expect(host?.textContent).toContain('owner@example.com')
  })

  it('lets invited editors rename trip metadata', async () => {
    const onRename = vi.fn()
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    await act(async () => {
      root?.render(<TripSettingsPanel tripId="trip_123" title="Lake Trip" role="editor" members={members} readOnly={false} onRename={onRename} />)
      await Promise.resolve()
    })

    const titleInput = host?.querySelector('input')
    const saveButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Save title'))

    await act(async () => {
      setInputValue(titleInput, 'Updated Lake Trip')
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onRename).toHaveBeenCalledWith('Updated Lake Trip')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('revokes a generated share link for owners', async () => {
    globalThis.fetch = jsonFetch([
      { ok: true, data: { shareUrl: 'http://localhost:5173/share/share_token' } },
      { ok: true, data: { disabled: true } },
    ])

    await act(async () => {
      root?.render(<TripSettingsPanel tripId="trip_123" title="Lake Trip" role="owner" members={members} readOnly={false} onRename={vi.fn()} />)
      await Promise.resolve()
    })

    const createShareButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Create sanitized share'))

    await act(async () => {
      createShareButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect((host?.querySelector('input[value*="/share/share_token"]') as HTMLInputElement | null)?.value)
      .toBe('http://localhost:5173/share/share_token')

    const revokeButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Disable share'))

    await act(async () => {
      revokeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/trips/trip_123/share-link', expect.objectContaining({ method: 'DELETE' }))
    expect(host?.textContent).not.toContain('http://localhost:5173/share/share_token')
  })

  it('copies generated invite links', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    globalThis.fetch = jsonFetch([
      { ok: true, data: { inviteUrl: 'http://localhost:5173/invites/invite_token' } },
    ])

    await act(async () => {
      root?.render(<TripSettingsPanel tripId="trip_123" title="Lake Trip" role="owner" members={members} readOnly={false} onRename={vi.fn()} />)
      await Promise.resolve()
    })

    const createInviteButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Create invite link'))

    await act(async () => {
      createInviteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const copyButton = Array.from(host?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Copy invite'))

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(writeText).toHaveBeenCalledWith('http://localhost:5173/invites/invite_token')
  })
})

function setInputValue(input: HTMLInputElement | null | undefined, value: string): void {
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function jsonFetch(payloads: unknown[]): typeof fetch {
  return vi.fn(async () => ({
    json: async () => payloads.shift(),
  })) as unknown as typeof fetch
}
