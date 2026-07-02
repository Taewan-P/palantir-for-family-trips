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

  it('updates family display name, origin, headcount, responsibility, readiness, and assigned account', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const family = doc.families[0]!

    await renderEditor(family, doc, onPatchEntity)

    setText(control('Display name'), 'Park Crew')
    setText(control('Origin'), 'Tokyo')
    setText(control('Headcount'), '5 travelers')
    setText(control('Responsibility'), 'Tickets')
    setText(control('Readiness'), '85')
    setSelect(control('Assigned account'), 'user_2')

    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { title: 'Park Crew' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { origin: 'Tokyo' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { headcount: '5 travelers' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { responsibility: 'Tickets' })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, { readiness: 85 })
    expect(onPatchEntity).toHaveBeenCalledWith('family', family.id, {
      assignedUserId: 'user_2',
      assignedUserEmail: 'editor@example.com',
    })
  })

  it('updates stay title, location, start and end day, category, confirmation, summary, and note', async () => {
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
    setTextarea(control('Summary'), 'New stay summary')
    setTextarea(control('Note'), 'Pack towels')

    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { title: 'Updated Basecamp' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { checkIn: 'Saturday arrival' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { checkOut: 'Sunday departure' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { category: 'backup' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { confirmationCode: 'XYZ789' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { summary: 'New stay summary' })
    expect(onPatchEntity).toHaveBeenCalledWith('stayItem', stay.id, { note: 'Pack towels' })
  })

  it('updates meal title, day, time label, location, status, reservation type, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const meal = doc.meals[0]!

    await renderEditor(meal, doc, onPatchEntity)

    setText(control('Title'), 'Dinner shift')
    setSelect(control('Day'), 'sat')
    setText(control('Time label'), '7:30 PM')
    setSelect(control('Location'), doc.locations[1]!.id)
    setText(control('Status'), 'Reserved')
    setText(control('Reservation type'), 'Table service')
    setTextarea(control('Note'), 'Ask for patio')

    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { title: 'Dinner shift' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { dayId: 'sat' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { timeLabel: '7:30 PM' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { status: 'Reserved' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { reservationType: 'Table service' })
    expect(onPatchEntity).toHaveBeenCalledWith('meal', meal.id, { note: 'Ask for patio' })
  })

  it('updates activity title, day, window, location, status, description, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const activity = doc.activities[0]!

    await renderEditor(activity, doc, onPatchEntity)

    setText(control('Title'), 'Trail plan')
    setSelect(control('Day'), 'sun')
    setText(control('Window'), '09:00-11:00')
    setSelect(control('Location'), doc.locations[1]!.id)
    setText(control('Status'), 'Go')
    setTextarea(control('Description'), 'Short loop')
    setTextarea(control('Note'), 'Bring layers')

    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { title: 'Trail plan' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { dayId: 'sun' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { window: '09:00-11:00' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { locationId: doc.locations[1]!.id })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { status: 'Go' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { description: 'Short loop' })
    expect(onPatchEntity).toHaveBeenCalledWith('activity', activity.id, { note: 'Bring layers' })
  })

  it('updates expense title, amount, payer, split, settled flag, and note', async () => {
    const onPatchEntity = vi.fn()
    const doc = testDoc()
    const expense = doc.expenses[0]!

    await renderEditor(expense, doc, onPatchEntity)

    setText(control('Title'), 'Fuel stop')
    setText(control('Amount'), '42.5')
    setText(control('Payer'), 'Park')
    setText(control('Split'), 'Manual')
    toggle(control('Settled'))
    setTextarea(control('Note'), 'Receipt uploaded')

    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { title: 'Fuel stop' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { amount: 42.5 })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { payer: 'Park' })
    expect(onPatchEntity).toHaveBeenCalledWith('expense', expense.id, { split: 'Manual' })
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
      { id: 'fri', date: '2026-07-03', title: 'Friday', shortLabel: 'Fri', code: 'D1' },
      { id: 'sat', date: '2026-07-04', title: 'Saturday', shortLabel: 'Sat', code: 'D2' },
      { id: 'sun', date: '2026-07-05', title: 'Sunday', shortLabel: 'Sun', code: 'D3' },
    ],
    families: [
      {
        id: 'fam_1',
        type: 'family',
        title: 'Park Family',
        origin: 'Seoul',
        headcount: '4 travelers',
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
        note: 'Door code pending',
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
        allocations: {},
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

function toggle(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  if (!(element instanceof HTMLInputElement) || element.disabled) return
  act(() => {
    element.click()
  })
}
