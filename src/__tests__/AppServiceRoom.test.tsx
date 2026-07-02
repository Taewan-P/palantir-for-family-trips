import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { createGuidedTripDocument, createTripFromTemplate } from '../shared/trip-template'
import { VIEWER_PROFILE_STORAGE_KEY } from '../tripModel'

const room = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  document: null as unknown,
  version: 0,
  status: 'connecting' as 'connecting' | 'open',
}))

vi.mock('../app/useTripRoom', () => ({
  useTripRoom: () => ({
    document: room.document,
    version: room.version,
    status: room.status,
    sendCommand: room.sendCommand,
  }),
}))

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

describe('App service room wiring', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    room.sendCommand.mockClear()
    room.document = null
    room.version = 0
    room.status = 'connecting'
    window.localStorage.clear()
    window.localStorage.setItem(VIEWER_PROFILE_STORAGE_KEY, JSON.stringify({ familyId: 'north-star' }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    window.localStorage.clear()
  })

  it('queues service edits while the trip room is still connecting', async () => {
    await act(async () => {
      root?.render(<App serviceTripId="trip_123" initialServiceDocument={createTripFromTemplate({ id: 'trip_123', title: 'Queued Trip' })} />)
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('sync connecting')
    expect(host?.textContent).not.toContain('autosave live')

    const input = host?.querySelector('input[placeholder="Search..."]') as HTMLInputElement | null
    expect(input).not.toBeNull()

    await act(async () => {
      setNativeInputValue(input!, 'pizza')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    expect(room.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'uiState.update',
      payload: { searchQuery: 'pizza' },
    }))
  })

  it('repairs legacy public-copy text before rendering member service docs', async () => {
    const document = createTripFromTemplate({ id: 'trip_legacy', title: 'Legacy Trip' })
    document.selectedPage = 'stay'
    document.selection = { type: 'location', id: 'pine-airbnb' }
    const basecamp = document.locations.find((location) => location.id === 'pine-airbnb')
    basecamp!.accessNote = 'Arrival and access details are intentionally redacted in the public version.'

    await act(async () => {
      root?.render(<App serviceTripId="trip_legacy" initialServiceDocument={document} />)
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Confirm community access, guest passes, and the arrival handoff before departure.')
    expect(host?.textContent).not.toContain('public version')
  })

  it('keeps local page navigation after the live room snapshot loads', async () => {
    const document = createTripFromTemplate({ id: 'trip_live', title: 'Live Trip' })
    room.document = document
    room.version = 3
    room.status = 'open'
    window.localStorage.setItem(VIEWER_PROFILE_STORAGE_KEY, JSON.stringify({ familyId: document.families[0]?.id }))

    await act(async () => {
      root?.render(<App serviceTripId="trip_live" initialServiceDocument={document} />)
      await Promise.resolve()
    })

    const mealsButton = host?.querySelector('button[title="Meals"]')
    expect(mealsButton).not.toBeNull()

    await act(async () => {
      mealsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('autosave live')
    expect(host?.textContent).toContain('meal records')
  })

  it('keeps rendering after a service create command selects an entity before the room echo arrives', async () => {
    const document = createGuidedTripDocument({
      title: 'Blank Live Trip',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
    })
    document.selectedPage = 'families'
    document.selection = { type: 'family', id: document.families[0]!.id }
    document.tasks = []
    window.localStorage.setItem(VIEWER_PROFILE_STORAGE_KEY, JSON.stringify({ familyId: document.families[0]?.id }))

    await act(async () => {
      root?.render(<App serviceTripId="trip_live_blank" initialServiceDocument={document} />)
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('No tasks created')

    const addTaskButton = Array.from(host?.querySelectorAll('button') ?? []).find((button) => (
      button.textContent?.trim() === 'Add task'
    ))
    expect(addTaskButton).not.toBeNull()

    await act(async () => {
      addTaskButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(room.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'entity.create',
      payload: expect.objectContaining({
        entityType: 'task',
        entity: expect.objectContaining({ ownerFamilyId: document.families[0]!.id }),
      }),
    }))
    expect(host?.textContent).toContain('Select any timeline block')
  })
})

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
}
