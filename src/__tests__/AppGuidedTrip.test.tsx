import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../App'
import { createGuidedTripDocument, createTripFromTemplate } from '../shared/trip-template'
import { TRIP_DOCUMENT_STORAGE_KEY } from '../tripModel'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

async function settleEffects() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function createBlankGuidedDocument() {
  const document = createGuidedTripDocument({
    title: 'Japan Summer 2026',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    destinationName: 'Tokyo',
    families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
  })
  document.routes = []
  document.itineraryItems = []
  document.meals = []
  document.activities = []
  document.expenses = []
  document.tasks = []
  if (document.locations[0]) {
    document.locations[0].coordinates = { lat: 35.6812, lng: 139.7671 }
  }
  return document
}

async function renderEditableDocument(document: ReturnType<typeof createBlankGuidedDocument>) {
  await act(async () => {
    root?.render(<App initialServiceDocument={document} />)
    await Promise.resolve()
  })

  const familyButton = Array.from(host?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent?.includes('Park Household'),
  )
  await act(async () => {
    familyButton?.click()
    await Promise.resolve()
  })
}

function navButton(title: string) {
  return host?.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
}

function buttonWithText(text: string) {
  return Array.from(host?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined
}

function selectedEditorTitle() {
  const editor = host?.querySelector('[aria-label="Selected item editor"]')
  return editor?.querySelector<HTMLInputElement>('input[aria-label="Title"]')
}

describe('App guided trip day shells', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    window.localStorage.clear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    window.localStorage.clear()
  })

  it('renders guided document day labels in dashboard controls', async () => {
    const document = createGuidedTripDocument({
      title: 'Japan Summer 2026',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
    })
    document.selectedPage = 'itinerary'
    document.locations[0]!.coordinates = { lat: 35.6812, lng: 139.7671 }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const text = host?.textContent || ''
    expect(text).toContain('Fri 7/10')
    expect(text).toContain('Sat 7/11')
    expect(text).not.toContain('Thu 4/09')
    expect(text).not.toContain('Pine Mountain Lake')

    const buttonLabels = Array.from(host?.querySelectorAll('button') ?? []).map((button) => button.textContent?.trim())
    expect(buttonLabels).toContain('Fri 7/10')
    expect(buttonLabels).toContain('Day 1')
  })

  it('starts guided documents on their first document day', async () => {
    const document = createGuidedTripDocument({
      title: 'Japan Summer 2026',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
    })
    document.selectedPage = 'itinerary'
    document.locations[0]!.coordinates = { lat: 35.6812, lng: 139.7671 }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const text = host?.textContent || ''
    expect(text).toContain('Fri 7/10 12:00 AM')
    expect(text).not.toContain('Thu 4/09')
    expect(text).not.toContain('Sun 4/12')
    expect(text).not.toContain('18:00')

    const firstDayButton = Array.from(host?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Fri 7/10',
    )
    expect(firstDayButton?.className).toContain('border-[#58A6FF]')
  })

  it('falls back to seeded day labels when the document has no days', async () => {
    const document = createTripFromTemplate({ id: 'trip_seed', title: 'Seed Trip' })
    document.selectedPage = 'itinerary'

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('Thu 4/09')
    expect(host?.textContent).toContain('Transit Day')
  })

  it('does not backfill seeded demo content into guided documents', async () => {
    const guidedDoc = createGuidedTripDocument({
      title: 'Maine Summer 2026',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      destinationName: 'Portland',
      families: [{ displayName: 'Lee Household', origin: 'Boston', adults: 2, kids: 0 }],
    })
    guidedDoc.selectedPage = 'families'

    await act(async () => {
      root?.render(<App initialServiceDocument={guidedDoc} />)
    })
    await settleEffects()

    const serviceMountText = host?.textContent || ''
    for (const seedText of ['Parkers', 'Jiangs', 'Riveras', 'Pine Mountain Lake', 'Yosemite', 'Duckfat', 'Portland Head Light']) {
      expect(serviceMountText).not.toContain(seedText)
    }

    await act(async () => {
      root?.unmount()
      root = createRoot(host!)
    })

    window.localStorage.setItem(TRIP_DOCUMENT_STORAGE_KEY, JSON.stringify(guidedDoc))

    await act(async () => {
      root?.render(<App />)
    })
    await settleEffects()

    const savedAfterMount = JSON.parse(window.localStorage.getItem(TRIP_DOCUMENT_STORAGE_KEY) || 'null') as typeof guidedDoc
    expect(savedAfterMount.routes).toEqual([])
    expect(savedAfterMount.itineraryItems).toEqual([])
    expect(savedAfterMount.meals).toEqual([])
    expect(savedAfterMount.activities).toEqual([])
    expect(savedAfterMount.expenses).toEqual([])
    expect(savedAfterMount.tasks).toEqual([])
    expect(savedAfterMount.pageNotes).toEqual({
      itinerary: '',
      stay: '',
      meals: '',
      activities: '',
      expenses: '',
      families: '',
    })

    await act(async () => {
      root?.unmount()
      root = createRoot(host!)
      root.render(<App />)
    })
    await settleEffects()

    const savedAfterRemount = JSON.parse(window.localStorage.getItem(TRIP_DOCUMENT_STORAGE_KEY) || 'null') as typeof guidedDoc
    expect(savedAfterRemount.routes).toEqual([])
    expect(savedAfterRemount.itineraryItems).toEqual([])
    expect(savedAfterRemount.meals).toEqual([])
    expect(savedAfterRemount.activities).toEqual([])
    expect(savedAfterRemount.expenses).toEqual([])
    expect(savedAfterRemount.tasks).toEqual([])

    const leakedText = `${host?.textContent || ''}\n${JSON.stringify(savedAfterRemount)}`
    for (const seedText of ['Parkers', 'Jiangs', 'Riveras', 'Pine Mountain Lake', 'Yosemite', 'Duckfat', 'Portland Head Light']) {
      expect(leakedText).not.toContain(seedText)
    }
  })

  it('adds and selects an itinerary item from the blank day shell', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'itinerary'

    await renderEditableDocument(document)

    expect(host?.textContent).toContain('No itinerary items')
    await act(async () => {
      buttonWithText('Add itinerary item')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New itinerary item')
  })

  it('adds and selects a meal from the blank meals page', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'meals'

    await renderEditableDocument(document)

    expect(host?.textContent).toContain('No meals planned')
    await act(async () => {
      buttonWithText('Add meal')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New meal')
  })

  it('adds and selects an activity from the blank activities page', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'activities'

    await renderEditableDocument(document)

    expect(host?.textContent).toContain('No activities planned')
    await act(async () => {
      buttonWithText('Add activity')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New activity')
  })

  it('adds and selects an expense from the blank expenses page', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'expenses'

    await renderEditableDocument(document)

    expect(host?.textContent).toContain('No expenses tracked')
    await act(async () => {
      buttonWithText('Add expense')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New expense')
  })

  it('adds and selects a route from the blank map routes state', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'itinerary'

    await renderEditableDocument(document)

    expect(host?.textContent).toContain('No routes planned')
    await act(async () => {
      buttonWithText('Add route')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New route')
  })

  it('adds and selects a task from the blank task state', async () => {
    const document = createBlankGuidedDocument()
    document.selectedPage = 'families'

    await renderEditableDocument(document)
    await act(async () => {
      navButton('Families')?.click()
      await Promise.resolve()
    })

    expect(host?.textContent).toContain('No tasks created')
    await act(async () => {
      buttonWithText('Add task')?.click()
      await Promise.resolve()
    })

    expect(selectedEditorTitle()?.value).toBe('New task')
    expect(host?.textContent).toContain('New task')
  })
})
