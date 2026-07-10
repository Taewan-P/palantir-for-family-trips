import { Check, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import type { CreateGuidedTripRequest } from '../shared/trip-types'

export type GuidedTripSetupFormProps = {
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (request: CreateGuidedTripRequest) => Promise<void> | void
}

type FamilyFormRow = {
  displayName: string
  origin: string
  adults: string
  kids: string
}

const inputClass = 'w-full border border-[#30363D] bg-[#0A0C10] px-2 py-1.5 text-[11px] text-[#C9D1D9] outline-none transition-colors placeholder:text-[#8B949E]/60 focus:border-[#58A6FF]/70 disabled:opacity-50'
const labelClass = 'mb-1 block text-[9px] font-black uppercase tracking-[0.16em] text-[#8B949E]'
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_FAMILIES = 12

export function GuidedTripSetupForm({ busy, error, onCancel, onSubmit }: GuidedTripSetupFormProps) {
  const today = todayInputValue()
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [destinationName, setDestinationName] = useState('')
  const [basecampAddress, setBasecampAddress] = useState('')
  const [families, setFamilies] = useState<FamilyFormRow[]>([defaultFamily()])
  const [validationError, setValidationError] = useState<string | null>(null)
  const activeError = validationError || error

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const request = buildRequest({ title, startDate, endDate, destinationName, basecampAddress, families })
    const message = validateRequest(request)
    if (message) {
      setValidationError(message)
      return
    }

    setValidationError(null)
    await onSubmit(request)
  }

  function updateFamily(index: number, patch: Partial<FamilyFormRow>) {
    setFamilies((current) => current.map((family, familyIndex) => (
      familyIndex === index ? { ...family, ...patch } : family
    )))
  }

  return (
    <form className="mb-4 border border-[#30363D] bg-[#161B22] p-4" noValidate onSubmit={handleSubmit}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#30363D] pb-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">Guided setup</div>
          <h2 className="mt-1 text-[13px] font-black uppercase tracking-[0.08em] text-[#C9D1D9]">New trip</h2>
        </div>
        <button
          aria-label="Cancel setup"
          className="inline-flex h-8 w-8 items-center justify-center border border-[#30363D] text-[#8B949E] transition-colors hover:border-[#C9D1D9]/50 hover:text-[#C9D1D9] disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {activeError ? <div className="mb-3 border border-[#F85149] p-2 text-[11px] text-[#F85149]" role="alert">{activeError}</div> : null}

      <fieldset className="grid gap-3 disabled:opacity-60" disabled={busy}>
        <div className="grid gap-3 md:grid-cols-[1fr_140px_140px]">
          <label>
            <span className={labelClass}>Trip title</span>
            <input
              className={inputClass}
              name="title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Yosemite family operations"
              value={title}
            />
          </label>
          <label>
            <span className={labelClass}>Start date</span>
            <input
              className={`${inputClass} font-mono tabular-nums`}
              name="startDate"
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label>
            <span className={labelClass}>End date</span>
            <input
              className={`${inputClass} font-mono tabular-nums`}
              name="endDate"
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className={labelClass}>Destination</span>
            <input
              className={inputClass}
              name="destinationName"
              onChange={(event) => setDestinationName(event.target.value)}
              placeholder="Pine Mountain Lake"
              value={destinationName}
            />
          </label>
          <label>
            <span className={labelClass}>Basecamp address</span>
            <input
              className={inputClass}
              name="basecampAddress"
              onChange={(event) => setBasecampAddress(event.target.value)}
              placeholder="Street address or booking location"
              value={basecampAddress}
            />
          </label>
        </div>

        <section className="border-t border-[#30363D] pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#C9D1D9]">Family units</div>
            <button
              aria-label="Add family"
              className="inline-flex items-center gap-1.5 border border-[#58A6FF]/50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/10"
              disabled={families.length >= MAX_FAMILIES}
              onClick={() => setFamilies((current) => (
                current.length >= MAX_FAMILIES ? current : [...current, defaultFamily()]
              ))}
              type="button"
            >
              <Plus size={12} />
              Add
            </button>
          </div>

          <div className="grid gap-2">
            {families.map((family, index) => (
              <div
                className="grid gap-2 border-t border-[#30363D]/70 pt-2 first:border-t-0 first:pt-0 md:grid-cols-[1fr_1fr_78px_78px_32px]"
                data-family-row
                key={index}
              >
                <label>
                  <span className={labelClass}>Family {index + 1}</span>
                  <input
                    className={inputClass}
                    name={`families.${index}.displayName`}
                    onChange={(event) => updateFamily(index, { displayName: event.target.value })}
                    placeholder="Park Household"
                    value={family.displayName}
                  />
                </label>
                <label>
                  <span className={labelClass}>Origin</span>
                  <input
                    className={inputClass}
                    name={`families.${index}.origin`}
                    onChange={(event) => updateFamily(index, { origin: event.target.value })}
                    placeholder="San Jose"
                    value={family.origin}
                  />
                </label>
                <label>
                  <span className={labelClass}>Adults</span>
                  <input
                    className={`${inputClass} font-mono tabular-nums`}
                    max={20}
                    min={0}
                    name={`families.${index}.adults`}
                    onChange={(event) => updateFamily(index, { adults: event.target.value })}
                    type="number"
                    value={family.adults}
                  />
                </label>
                <label>
                  <span className={labelClass}>Kids</span>
                  <input
                    className={`${inputClass} font-mono tabular-nums`}
                    max={20}
                    min={0}
                    name={`families.${index}.kids`}
                    onChange={(event) => updateFamily(index, { kids: event.target.value })}
                    type="number"
                    value={family.kids}
                  />
                </label>
                <button
                  aria-label={`Remove family ${index + 1}`}
                  className="mt-5 inline-flex h-8 w-8 items-center justify-center border border-[#30363D] text-[#8B949E] transition-colors hover:border-[#F85149]/50 hover:text-[#F85149] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={families.length === 1}
                  onClick={() => setFamilies((current) => current.filter((_, familyIndex) => familyIndex !== index))}
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-[#30363D] pt-3">
          <button
            className="inline-flex items-center gap-1.5 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#8B949E] transition-colors hover:border-[#C9D1D9]/50 hover:text-[#C9D1D9]"
            onClick={onCancel}
            type="button"
          >
            <X size={13} />
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-1.5 border border-[#3FB950]/50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#3FB950] transition-colors hover:bg-[#3FB950]/10 disabled:opacity-50"
            type="submit"
          >
            <Check size={13} />
            {busy ? 'Creating' : 'Create trip'}
          </button>
        </div>
      </fieldset>
    </form>
  )
}

function defaultFamily(): FamilyFormRow {
  return { displayName: '', origin: '', adults: '1', kids: '0' }
}

function todayInputValue(): string {
  const date = new Date()
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildRequest(input: {
  title: string
  startDate: string
  endDate: string
  destinationName: string
  basecampAddress: string
  families: FamilyFormRow[]
}): CreateGuidedTripRequest {
  const basecampAddress = input.basecampAddress.trim()
  return {
    title: input.title.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    destinationName: input.destinationName.trim(),
    ...(basecampAddress ? { basecampAddress } : {}),
    families: input.families.map((family) => {
      const origin = family.origin.trim()
      return {
        displayName: family.displayName.trim(),
        ...(origin ? { origin } : {}),
        adults: parseHeadcount(family.adults),
        kids: parseHeadcount(family.kids),
      }
    }),
  }
}

function validateRequest(request: CreateGuidedTripRequest): string | null {
  if (!request.title) return 'Trip title is required'
  if (request.title.length > 120) return 'Trip title must be 120 characters or fewer'
  const startDate = readCalendarDate(request.startDate, 'Start date')
  if (typeof startDate === 'string') return startDate
  const endDate = readCalendarDate(request.endDate, 'End date')
  if (typeof endDate === 'string') return endDate
  if (endDate < startDate) return 'End date must be on or after start date'
  const dayCount = Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1
  if (dayCount < 1 || dayCount > 31) return 'Trip length must be between 1 and 31 days'
  if (!request.destinationName) return 'Destination name is required'
  if (request.destinationName.length > 120) return 'Destination name must be 120 characters or fewer'
  if (request.basecampAddress && request.basecampAddress.length > 240) return 'Basecamp address must be 240 characters or fewer'
  if (request.families.length === 0) return 'At least one family is required'
  if (request.families.length > MAX_FAMILIES) return 'At most 12 families are supported'

  for (const family of request.families) {
    if (!family.displayName) return 'Family display name is required'
    if (family.displayName.length > 80) return 'Family display name must be 80 characters or fewer'
    if (family.origin && family.origin.length > 120) return 'Family origin must be 120 characters or fewer'
    if (!Number.isInteger(family.adults) || family.adults < 0 || family.adults > 20) return 'Adults must be an integer between 0 and 20'
    if (!Number.isInteger(family.kids) || family.kids < 0 || family.kids > 20) return 'Kids must be an integer between 0 and 20'
    if (family.adults + family.kids < 1) return 'Family headcount must include at least one person'
  }

  return null
}

function parseHeadcount(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function readCalendarDate(value: string, label: string): Date | string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return `${label} must use YYYY-MM-DD`

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(0, month - 1, day))
  date.setUTCFullYear(year)
  if (formatDate(date) !== value) return `${label} must be a valid calendar date`
  return date
}

function formatDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
