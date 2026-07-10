import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SelectedItemEditor, type SelectedItemEditorProps, type SelectedItemMember } from '../SelectedItemEditor'
import type { TripDocument, TripEntity } from '../../shared/trip-types'
import { createTripFromTemplate } from '../../shared/trip-template'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

const members: SelectedItemMember[] = [
  { userId: 'user_1', email: 'owner@example.com', name: 'Owner User', role: 'owner' },
  { userId: 'user_2', email: 'editor@example.com', name: 'Editor User', role: 'editor' },
]

describe('SelectedItemEditor', () => {
  beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('updates family identity, headcount fields, responsibility, readiness, and assigned account', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const family = doc.families[0]!

    await renderEditor(family, doc, onPatchEntity)

    setText(control('Display name'), 'Park Crew')
    setText(control('Origin'), 'Tokyo')
    setText(control('Short origin'), 'TYO')
    setText(control('Adults'), '3')
    setText(control('Kids'), '2')
    setText(control('Responsibility'), 'Tickets')
    setText(control('Readiness'), '85')
    setSelect(control('Assigned account'), 'user_2')

    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { title: 'Park Crew' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { origin: 'Tokyo' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { shortOrigin: 'TYO' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, expect.objectContaining({ adults: 3, headcount: '3 adults, 1 kid' }))
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, expect.objectContaining({ kids: 2, headcount: '2 adults, 2 kids' }))
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { responsibility: 'Tickets' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { readiness: 85 })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, {
      assignedUserId: 'user_2',
      assignedUserEmail: 'editor@example.com',
    })
  })

  it('updates stay title, location, dates, access details, summary, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const stay = {
      ...doc.stayItems[0]!,
      checkIn: 'fri',
      checkOut: 'sat',
      confirmationCode: 'ABC123',
    }

    await renderEditor(stay, doc, onPatchEntity)

    setText(control('Title'), 'Updated Basecamp')
    setSelect(control('Location'), doc.locations[1]!.id)
    setText(control('Start day'), 'Saturday arrival')
    setText(control('End day'), 'Sunday departure')
    setText(control('Category'), 'backup')
    setText(control('Confirmation'), 'XYZ789')
    setText(control('Address'), '100 New Basecamp Way')
    setTextarea(control('Access note'), 'Use the east entrance')
    setTextarea(control('Parking note'), 'Two vehicles maximum')
    setTextarea(control('Summary'), 'New stay summary')
    setTextarea(control('Note'), 'Pack towels')

    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { title: 'Updated Basecamp' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { checkIn: 'Saturday arrival' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { checkOut: 'Sunday departure' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { category: 'backup' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { confirmationCode: 'XYZ789' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { address: '100 New Basecamp Way' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { accessNote: 'Use the east entrance' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { parkingNote: 'Two vehicles maximum' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { summary: 'New stay summary' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { note: 'Pack towels' })
  })

  it('updates meal title, day, time, owner, location, status, reservation type, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const meal = doc.meals[0]!

    await renderEditor(meal, doc, onPatchEntity)

    setText(control('Title'), 'Dinner shift')
    setSelect(control('Day'), 'sat')
    setText(control('Time label'), '7:30 PM')
    setText(control('Owner'), 'Park Family')
    setSelect(control('Location'), doc.locations[1]!.id)
    setText(control('Status'), 'Reserved')
    setText(control('Reservation type'), 'Table service')
    setTextarea(control('Note'), 'Ask for patio')

    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { title: 'Dinner shift' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { dayId: 'sat' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { timeLabel: '7:30 PM' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { owner: 'Park Family' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { status: 'Reserved' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { reservationType: 'Table service' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { note: 'Ask for patio' })
  })

  it('updates activity timing, location, status, risk, fallback, description, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const activity = doc.activities[0]!

    await renderEditor(activity, doc, onPatchEntity)

    setText(control('Title'), 'Trail plan')
    setSelect(control('Day'), 'sun')
    setText(control('Window'), '09:00-11:00')
    setSelect(control('Location'), doc.locations[1]!.id)
    setText(control('Status'), 'Go')
    setText(control('Risk level'), 'Medium')
    setTextarea(control('Description'), 'Short loop')
    setTextarea(control('Fallback'), 'Museum visit')
    setTextarea(control('Note'), 'Bring layers')

    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { title: 'Trail plan' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { dayId: 'sun' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { window: '09:00-11:00' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { status: 'Go' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { riskLevel: 'Medium' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { description: 'Short loop' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { backup: 'Museum visit' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { note: 'Bring layers' })
  })

  it('updates expense title, amount, payer, allocation mode, allocation, settled flag, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const expense = doc.expenses[0]!

    await renderEditor(expense, doc, onPatchEntity)

    setText(control('Title'), 'Fuel stop')
    setText(control('Amount'), '42.5')
    setText(control('Payer'), 'Park')
    setText(control('Split'), 'Manual')
    setSelect(control('Allocation mode'), 'manual')
    setText(control('Park Family allocation'), '21.25')
    toggle(control('Settled'))
    setTextarea(control('Note'), 'Receipt uploaded')

    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { title: 'Fuel stop' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { amount: 42.5 })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { payer: 'Park' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { split: 'Manual' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { allocationMode: 'manual' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, {
      allocations: { ...expense.allocations, fam_1: 21.25 },
    })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { settled: !expense.settled })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { note: 'Receipt uploaded' })
  })

  it('does not patch blank numeric input', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const expense = doc.expenses[0]!

    await renderEditor(expense, doc, onPatchEntity)

    setText(control('Amount'), '')

    expect(onPatchEntity).not.toHaveBeenCalled()
  })

  it('updates itinerary family linkage and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const item = doc.itineraryItems[0]!

    await renderEditor(item, doc, onPatchEntity)

    setSelect(control('Linked family'), 'fam_2')
    setTextarea(control('Note'), 'Meet at the station')

    expect(onPatchEntity).toHaveBeenCalledWith('itineraryItem', item.id, { familyIds: ['fam_2'] })
    expect(onPatchEntity).toHaveBeenCalledWith('itineraryItem', item.id, { note: 'Meet at the station' })
  })

  it('updates route origin, stops, destination, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const route = doc.routes[0]!

    await renderEditor(route, doc, onPatchEntity)

    setText(control('Origin'), 'Seoul Station')
    setMultiSelect(control('Stops'), ['loc_1', 'loc_2'])
    setSelect(control('Destination'), 'loc_2')
    setTextarea(control('Note'), 'Avoid toll roads')

    expect(onPatchEntity).toHaveBeenCalledWith('route', route.id, { origin: 'Seoul Station' })
    expect(onPatchEntity).toHaveBeenCalledWith('route', route.id, { stopLocationIds: ['loc_1', 'loc_2'] })
    expect(onPatchEntity).toHaveBeenCalledWith('route', route.id, { destinationLocationId: 'loc_2' })
    expect(onPatchEntity).toHaveBeenCalledWith('route', route.id, { note: 'Avoid toll roads' })
  })

  it('updates task title, status, owner family, day, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const task = doc.tasks[0]!

    await renderEditor(task, doc, onPatchEntity)

    setText(control('Title'), 'Confirm rental car')
    setText(control('Status'), 'done')
    setSelect(control('Owner family'), doc.families[1]!.id)
    setSelect(control('Day'), 'sat')
    setTextarea(control('Note'), 'Call by Friday')

    expect(onPatchEntity).toHaveBeenCalledWith('task', task.id, { title: 'Confirm rental car' })
    expect(onPatchEntity).toHaveBeenCalledWith('task', task.id, { status: 'done' })
    expect(onPatchEntity).toHaveBeenCalledWith('task', task.id, { ownerFamilyId: doc.families[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('task', task.id, { dayId: 'sat' })
    expect(onPatchEntity).toHaveBeenCalledWith('task', task.id, { note: 'Call by Friday' })
  })

  it('updates a day shell label, date, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const day = doc.days![0]!

    await renderEditor(day, doc, onPatchEntity)

    setText(control('Label'), 'Arrival day')
    setText(control('Date'), '2026-07-11')
    setTextarea(control('Note'), 'Meet at noon')

    expect(onPatchEntity).toHaveBeenCalledWith('day', day.id, { title: 'Arrival day' })
    expect(onPatchEntity).toHaveBeenCalledWith('day', day.id, { date: '2026-07-11' })
    expect(onPatchEntity).toHaveBeenCalledWith('day', day.id, { note: 'Meet at noon' })
  })

  it('renders values and disables controls in read-only mode', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const family = doc.families[0]!

    await renderEditor(family, doc, onPatchEntity, true)

    expect(control('Display name').value).toBe(family.title)
    expect(control('Origin').value).toBe(family.origin)
    expect(control('Assigned account').value).toBe(family.assignedUserId || '')

    const controls = Array.from(host?.querySelectorAll('input, select, textarea') ?? [])
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((item) => item.hasAttribute('readonly') || item.hasAttribute('disabled'))).toBe(true)

    setText(control('Origin'), 'Blocked edit')
    expect(onPatchEntity).not.toHaveBeenCalled()
  })

  it('disables account assignment for non-owner editors', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const family = doc.families[0]!

    await act(async () => {
      root?.render(
        <SelectedItemEditor
          doc={doc}
          days={doc.days || []}
          entity={family}
          members={members}
          readOnly={false}
          canAssignMembers={false}
          onPatchEntity={onPatchEntity as SelectedItemEditorProps['onPatchEntity']}
        />,
      )
      await Promise.resolve()
    })

    expect(control('Assigned account')).toHaveProperty('disabled', true)
    setSelect(control('Assigned account'), 'user_2')
    expect(onPatchEntity).not.toHaveBeenCalledWith('family', family.id, expect.objectContaining({ assignedUserId: 'user_2' }))
  })
})

async function renderEditor(
  entity: TripEntity,
  doc: TripDocument,
  onPatchEntity: ReturnType<typeof vi.fn>,
  readOnly = false,
): Promise<void> {
  await act(async () => {
    root?.render(
      <SelectedItemEditor
        doc={doc}
        days={doc.days || []}
        entity={entity}
        members={members}
        readOnly={readOnly}
        onPatchEntity={onPatchEntity as SelectedItemEditorProps['onPatchEntity']}
      />,
    )
    await Promise.resolve()
  })
}

function testDoc(): TripDocument {
  const doc = createTripFromTemplate({ id: 'trip_test', title: 'Test Trip' })
  return {
    ...doc,
    days: [
      { id: 'fri', type: 'day', date: '2026-07-03', title: 'Friday', shortLabel: 'Fri', code: 'D1' },
      { id: 'sat', type: 'day', date: '2026-07-04', title: 'Saturday', shortLabel: 'Sat', code: 'D2' },
      { id: 'sun', type: 'day', date: '2026-07-05', title: 'Sunday', shortLabel: 'Sun', code: 'D3' },
    ],
    families: [
      {
        id: 'fam_1',
        type: 'family',
        title: 'Park Family',
        origin: 'Seoul',
        shortOrigin: 'SEL',
        adults: 2,
        kids: 1,
        headcount: '2 adults, 1 kid',
        responsibility: 'Meals',
        readiness: 50,
        assignedUserId: 'user_1',
        assignedUserEmail: 'owner@example.com',
      },
      { id: 'fam_2', type: 'family', title: 'Kim Family', origin: 'Busan' },
    ],
    locations: [
      { id: 'loc_1', type: 'location', title: 'Basecamp', category: 'stay', address: '1 Pine Road' },
      { id: 'loc_2', type: 'location', title: 'Trailhead', category: 'activity', address: '2 Valley Road' },
    ],
    stayItems: [
      {
        id: 'stay_1',
        type: 'stayItem',
        title: 'Cabin',
        locationId: 'loc_1',
        category: 'primary',
        summary: 'Main cabin',
        address: '1 Pine Road',
        accessNote: 'Gate code pending',
        parkingNote: 'Driveway parking',
        note: 'Door code pending',
      },
    ],
    routes: [
      {
        id: 'route_1',
        type: 'route',
        title: 'Arrival route',
        familyId: 'fam_1',
        origin: 'Seoul',
        destinationLocationId: 'loc_1',
        stopLocationIds: [],
        note: '',
      },
    ],
    itineraryItems: [
      {
        id: 'itinerary_1',
        type: 'itineraryItem',
        title: 'Arrival',
        dayId: 'fri',
        startSlot: 1,
        span: 2,
        familyIds: ['fam_1'],
        note: '',
      },
    ],
    meals: [
      {
        id: 'meal_1',
        type: 'meal',
        title: 'Dinner',
        dayId: 'fri',
        timeLabel: '18:00',
        locationId: 'loc_1',
        status: 'Pending',
        reservationType: 'Walk-in',
        note: 'Kid menu',
      },
    ],
    activities: [
      {
        id: 'activity_1',
        type: 'activity',
        title: 'Hike',
        dayId: 'sat',
        window: 'AM',
        locationId: 'loc_2',
        status: 'Watch',
        description: 'Easy trail',
        note: 'Check weather',
      },
    ],
    expenses: [
      {
        id: 'expense_1',
        type: 'expense',
        title: 'Groceries',
        payer: 'Kim',
        amount: 30,
        split: 'Equal',
        allocationMode: 'equal',
        allocations: { fam_1: 15, fam_2: 15 },
        settled: false,
        note: 'Snacks',
      },
    ],
    tasks: [
      {
        id: 'task_1',
        type: 'task',
        title: 'Buy passes',
        status: 'open',
        ownerFamilyId: 'fam_1',
        dayId: 'fri',
        note: 'Online',
      },
    ],
  }
}

function control(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const element = host?.querySelector(`[aria-label="${label}"]`)
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element
  }
  throw new Error(`Missing control: ${label}`)
}

function setText(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  if (element.hasAttribute('readonly') || element.hasAttribute('disabled')) return
  act(() => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function setTextarea(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  setText(element, value)
}

function setSelect(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  if (!(element instanceof HTMLSelectElement) || element.disabled) return
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setMultiSelect(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  values: string[],
): void {
  if (!(element instanceof HTMLSelectElement) || element.disabled) return
  act(() => {
    for (const option of Array.from(element.options)) {
      option.selected = values.includes(option.value)
    }
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function toggle(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  if (!(element instanceof HTMLInputElement) || element.disabled) return
  act(() => {
    element.click()
  })
}
