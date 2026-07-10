import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '../App'
import { createGuidedTripDocument, createTripFromTemplate } from '../shared/trip-template'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

function createBlankGuidedDocument() {
  const document = createGuidedTripDocument({
    title: 'Shared Blank Trip',
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

async function renderReadOnlyPage(selectedPage: string) {
  const document = createBlankGuidedDocument()
  document.selectedPage = selectedPage
  await act(async () => {
    root?.unmount()
    root = createRoot(host!)
    root.render(<App initialServiceDocument={document} readOnly />)
    await Promise.resolve()
  })
}

function buttonsWithText(text: string) {
  return Array.from(host?.querySelectorAll('button') ?? []).filter((button) => button.textContent?.trim() === text)
}

function expectButtonsDisabled(text: string) {
  const buttons = buttonsWithText(text)
  expect(buttons.length).toBeGreaterThan(0)
  expect(buttons.every((button) => button.disabled)).toBe(true)
}

describe('App read-only mode', () => {
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

  it('shows shared trips without an editing identity prompt and disables mutation fields', async () => {
    const document = createTripFromTemplate({ id: 'trip_public', title: 'Shared Trip' })

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    expect(host?.textContent).not.toContain('Choose your family')
    expect(host?.textContent).toContain('read-only share')
    expect(host?.textContent).toContain('Shared Trip')
    expect(host?.textContent).not.toContain('Working as')

    const mutatingInputs = Array.from(host?.querySelectorAll('input, textarea') ?? []).filter((element) => (
      element.getAttribute('placeholder') !== 'Search...'
    ))
    expect(mutatingInputs.length).toBeGreaterThan(0)
    expect(mutatingInputs.every((element) => element.hasAttribute('readonly') || element.hasAttribute('disabled'))).toBe(true)
  })

  it('disables drive-stop edit controls in read-only mode', async () => {
    const document = createTripFromTemplate({ id: 'trip_public', title: 'Shared Trip' })
    document.selection = { type: 'family', id: document.families[0]?.id || '' }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const editButtons = Array.from(host?.querySelectorAll('button') ?? []).filter((button) => (
      button.textContent?.trim() === 'Edit'
    ))
    expect(editButtons.length).toBeGreaterThan(0)
    expect(editButtons.every((button) => button.disabled)).toBe(true)

    await act(async () => {
      editButtons[0]?.click()
      await Promise.resolve()
    })

    expect(host?.querySelector('input[placeholder="Stop name"]')).toBeNull()
  })

  it('disables mutating action chips in read-only mode', async () => {
    const document = createTripFromTemplate({ id: 'trip_public', title: 'Shared Trip' })
    document.selectedPage = 'meals'
    document.selection = { type: 'meal', id: 'thu-dinner' }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const actionButton = Array.from(host?.querySelectorAll('button') ?? []).find((button) => (
      button.textContent?.trim().startsWith('Mark ')
    ))
    expect(actionButton).toBeTruthy()
    expect(actionButton?.disabled).toBe(true)
  })

  it('disables selected item editor controls in read-only mode', async () => {
    const document = createTripFromTemplate({ id: 'trip_public', title: 'Shared Trip' })
    document.selection = { type: 'family', id: document.families[0]?.id || '' }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const editor = host?.querySelector('[aria-label="Selected item editor"]')
    expect(editor).toBeTruthy()

    const controls = Array.from(editor?.querySelectorAll('input, select, textarea') ?? [])
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((element) => element.hasAttribute('readonly') || element.hasAttribute('disabled'))).toBe(true)
  })

  it('disables guided blank-state add actions in read-only mode', async () => {
    await renderReadOnlyPage('itinerary')
    expectButtonsDisabled('Add itinerary item')
    expectButtonsDisabled('Add route')

    await renderReadOnlyPage('meals')
    expectButtonsDisabled('Add meal')

    await renderReadOnlyPage('activities')
    expectButtonsDisabled('Add activity')

    await renderReadOnlyPage('expenses')
    expectButtonsDisabled('Add expense')

    await renderReadOnlyPage('families')
    expectButtonsDisabled('Add task')
  })

  it('disables every expense mutation control in read-only mode', async () => {
    const document = createTripFromTemplate({ id: 'trip_public', title: 'Shared Trip' })
    const expense = document.expenses[0]!
    document.selectedPage = 'expenses'
    document.selection = { type: 'expense', id: expense.id }

    await act(async () => {
      root?.render(<App initialServiceDocument={document} readOnly />)
      await Promise.resolve()
    })

    const mutationLabels = new Set(['Equal split', 'Manual allocation', 'Individual', 'Settled', 'Open'])
    const mutationButtons = Array.from(host?.querySelectorAll('button') ?? []).filter((button) => (
      mutationLabels.has(button.textContent?.trim() || '')
    ))
    expect(mutationButtons.length).toBeGreaterThan(0)
    expect(mutationButtons.every((button) => button.disabled)).toBe(true)

    const expenseControls = Array.from(host?.querySelectorAll('input, select') ?? []).filter((element) => (
      element.getAttribute('placeholder') !== 'Search...'
    ))
    expect(expenseControls.length).toBeGreaterThan(0)
    expect(expenseControls.every((element) => element.hasAttribute('readonly') || element.hasAttribute('disabled'))).toBe(true)
  })
})
