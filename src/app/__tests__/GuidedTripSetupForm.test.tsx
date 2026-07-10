import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CreateGuidedTripRequest } from '../../shared/trip-types'
import { GuidedTripSetupForm } from '../GuidedTripSetupForm'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | null = null
let host: HTMLDivElement | null = null

describe('GuidedTripSetupForm', () => {
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

  it('renders fields for trip details and the first family', async () => {
    await renderForm()

    expect(input('title')).not.toBeNull()
    expect(input('startDate')?.type).toBe('date')
    expect(input('endDate')?.type).toBe('date')
    expect(input('destinationName')).not.toBeNull()
    expect(input('basecampAddress')).not.toBeNull()
    expect(input('families.0.displayName')).not.toBeNull()
    expect(input('families.0.origin')).not.toBeNull()
    expect(input('families.0.adults')?.value).toBe('1')
    expect(input('families.0.kids')?.value).toBe('0')
  })

  it('allows adding and removing family rows', async () => {
    await renderForm()

    expect(familyRows()).toHaveLength(1)
    expect(button('Remove family 1')?.disabled).toBe(true)

    await act(async () => {
      button('Add family')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(familyRows()).toHaveLength(2)

    await act(async () => {
      button('Remove family 2')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(familyRows()).toHaveLength(1)
  })

  it('submits a trimmed guided trip request payload', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })

    setValidTripValues()
    setInputValue(input('title'), '  Tokyo command post  ')
    setInputValue(input('destinationName'), '  Tokyo  ')
    setInputValue(input('basecampAddress'), '  1 Chome Marunouchi  ')
    setInputValue(input('families.0.displayName'), '  Park Household  ')
    setInputValue(input('families.0.origin'), '  Seoul  ')

    await submit()

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Tokyo command post',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      basecampAddress: '1 Chome Marunouchi',
      families: [{ displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 }],
    } satisfies CreateGuidedTripRequest)
  })

  it('blocks submit when required fields are missing', async () => {
    const cases = [
      ['title', 'Trip title is required'],
      ['destinationName', 'Destination name is required'],
      ['startDate', 'Start date must use YYYY-MM-DD'],
      ['endDate', 'End date must use YYYY-MM-DD'],
      ['families.0.displayName', 'Family display name is required'],
    ] as const

    for (const [field, message] of cases) {
      const onSubmit = vi.fn()
      await renderForm({ onSubmit })
      setValidTripValues()
      setInputValue(input(field), '')

      await submit()

      expect(onSubmit, field).not.toHaveBeenCalled()
      expect(host?.textContent, field).toContain(message)
    }
  })

  it('blocks submit when end date is before start date', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })
    setValidTripValues()
    setInputValue(input('startDate'), '2026-07-12')
    setInputValue(input('endDate'), '2026-07-10')

    await submit()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(host?.textContent).toContain('End date must be on or after start date')
  })

  it('blocks trip longer than 31 days', async () => {
    const onSubmit = vi.fn()
    await renderForm({ onSubmit })
    setValidTripValues()
    setInputValue(input('startDate'), '2026-07-01')
    setInputValue(input('endDate'), '2026-08-01')

    await submit()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(host?.textContent).toContain('Trip length must be between 1 and 31 days')
  })

  it('blocks overlong title or destination', async () => {
    const cases = [
      ['title', 121, 'Trip title must be 120 characters or fewer'],
      ['destinationName', 121, 'Destination name must be 120 characters or fewer'],
      ['basecampAddress', 241, 'Basecamp address must be 240 characters or fewer'],
    ] as const

    for (const [field, length, message] of cases) {
      const onSubmit = vi.fn()
      await renderForm({ onSubmit })
      setValidTripValues()
      setInputValue(input(field), 'x'.repeat(length))

      await submit()

      expect(onSubmit, field).not.toHaveBeenCalled()
      expect(host?.textContent, field).toContain(message)
    }
  })

  it('disables Add at 12 families', async () => {
    await renderForm()

    for (let index = 1; index < 12; index += 1) {
      await act(async () => {
        button('Add family')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    expect(familyRows()).toHaveLength(12)
    expect(button('Add family')?.disabled).toBe(true)
  })

  it('blocks overlong family display name or origin', async () => {
    const cases = [
      ['families.0.displayName', 81, 'Family display name must be 80 characters or fewer'],
      ['families.0.origin', 121, 'Family origin must be 120 characters or fewer'],
    ] as const

    for (const [field, length, message] of cases) {
      const onSubmit = vi.fn()
      await renderForm({ onSubmit })
      setValidTripValues()
      setInputValue(input(field), 'x'.repeat(length))

      await submit()

      expect(onSubmit, field).not.toHaveBeenCalled()
      expect(host?.textContent, field).toContain(message)
    }
  })

  it('marks validation errors as alerts', async () => {
    await renderForm()
    setValidTripValues()
    setInputValue(input('title'), '')

    await submit()

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('Trip title is required')
  })
})

async function renderForm(props: Partial<Parameters<typeof GuidedTripSetupForm>[0]> = {}): Promise<void> {
  await act(async () => {
    root?.render(
      <GuidedTripSetupForm
        busy={false}
        error={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        {...props}
      />,
    )
    await Promise.resolve()
  })
}

function input(name: string): HTMLInputElement | null {
  return host?.querySelector(`input[name="${name}"]`) ?? null
}

function button(label: string): HTMLButtonElement | null {
  return host?.querySelector(`button[aria-label="${label}"]`) ?? null
}

function familyRows(): Element[] {
  return Array.from(host?.querySelectorAll('[data-family-row]') ?? [])
}

function setValidTripValues(): void {
  setInputValue(input('title'), 'Tokyo Trip')
  setInputValue(input('startDate'), '2026-07-10')
  setInputValue(input('endDate'), '2026-07-12')
  setInputValue(input('destinationName'), 'Tokyo')
  setInputValue(input('basecampAddress'), '')
  setInputValue(input('families.0.displayName'), 'Park Household')
  setInputValue(input('families.0.origin'), '')
  setInputValue(input('families.0.adults'), '2')
  setInputValue(input('families.0.kids'), '1')
}

function setInputValue(inputElement: HTMLInputElement | null | undefined, value: string): void {
  if (!inputElement) return
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(inputElement, value)
    inputElement.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  await act(async () => {
    host?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}
