import type { ChangeEvent, ReactNode } from 'react'

import type { EntityByType, TripDay, TripDocument, TripEntity, TripEntityType } from '../shared/trip-types'

export type SelectedItemMember = {
  userId: string
  email: string
  name: string
  role: 'owner' | 'editor'
}

export type SelectedItemEditorProps = {
  doc: TripDocument
  days: Array<Pick<TripDay, 'id' | 'title' | 'shortLabel'>>
  entity: TripEntity | null
  members: SelectedItemMember[]
  readOnly: boolean
  onPatchEntity: <Type extends TripEntityType>(
    type: Type,
    id: string,
    patch: Partial<EntityByType[Type]>,
  ) => void
}

type Option = { value: string; label: string }

export function SelectedItemEditor({ doc, days, entity, members, readOnly, onPatchEntity }: SelectedItemEditorProps) {
  if (!entity) return null

  const locationOptions = doc.locations.map((location) => ({ value: location.id, label: location.title }))
  const familyOptions = doc.families.map((family) => ({ value: family.id, label: family.title }))
  const dayOptions = days.map((day) => ({ value: day.id, label: day.shortLabel || day.title }))
  const patch = <Type extends TripEntityType>(type: Type, id: string, value: Partial<EntityByType[Type]>) => {
    if (!readOnly) onPatchEntity(type, id, value)
  }
  const text = <Type extends TripEntityType>(
    label: string,
    type: Type,
    id: string,
    key: keyof EntityByType[Type],
    value: string | number | null | undefined,
    inputType = 'text',
  ) => (
    <Field label={label}>
      <input
        aria-label={label}
        type={inputType}
        value={value ?? ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(event) => patch(type, id, { [key]: event.target.value } as Partial<EntityByType[Type]>)}
        className={controlClass}
      />
    </Field>
  )
  const number = <Type extends TripEntityType>(
    label: string,
    type: Type,
    id: string,
    key: keyof EntityByType[Type],
    value: number | null | undefined,
  ) => (
    <Field label={label}>
      <input
        aria-label={label}
        type="number"
        value={value ?? ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(event) => {
          if (event.target.value === '') return
          const nextValue = Number(event.target.value)
          if (Number.isFinite(nextValue)) {
            patch(type, id, { [key]: nextValue } as Partial<EntityByType[Type]>)
          }
        }}
        className={controlClass}
      />
    </Field>
  )
  const textarea = <Type extends TripEntityType>(
    label: string,
    type: Type,
    id: string,
    key: keyof EntityByType[Type],
    value: string | null | undefined,
  ) => (
    <Field label={label}>
      <textarea
        aria-label={label}
        value={value ?? ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(event) => patch(type, id, { [key]: event.target.value } as Partial<EntityByType[Type]>)}
        className={`${controlClass} min-h-16 resize-none leading-relaxed`}
      />
    </Field>
  )
  const select = <Type extends TripEntityType>(
    label: string,
    type: Type,
    id: string,
    key: keyof EntityByType[Type],
    value: string | null | undefined,
    options: Option[],
  ) => (
    <Field label={label}>
      <select
        aria-label={label}
        value={value ?? ''}
        disabled={readOnly}
        onChange={(event) => patch(type, id, { [key]: event.target.value || null } as Partial<EntityByType[Type]>)}
        className={controlClass}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )

  let fields: ReactNode = null

  switch (entity.type) {
    case 'family':
      fields = (
        <>
          {text('Display name', 'family', entity.id, 'title', entity.title)}
          {text('Origin', 'family', entity.id, 'origin', entity.origin)}
          {text('Headcount', 'family', entity.id, 'headcount', entity.headcount)}
          {text('Responsibility', 'family', entity.id, 'responsibility', entity.responsibility)}
          {number('Readiness', 'family', entity.id, 'readiness', entity.readiness)}
          <Field label="Assigned account">
            <select
              aria-label="Assigned account"
              value={entity.assignedUserId || ''}
              disabled={readOnly}
              onChange={(event) => {
                const member = members.find((item) => item.userId === event.target.value)
                patch('family', entity.id, {
                  assignedUserId: member?.userId || null,
                  assignedUserEmail: member?.email || null,
                })
              }}
              className={controlClass}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} / {member.email}
                </option>
              ))}
            </select>
          </Field>
        </>
      )
      break
    case 'stayItem':
      fields = (
        <>
          {text('Title', 'stayItem', entity.id, 'title', entity.title)}
          {select('Location', 'stayItem', entity.id, 'locationId', entity.locationId, locationOptions)}
          {text('Start day', 'stayItem', entity.id, 'checkIn', entity.checkIn)}
          {text('End day', 'stayItem', entity.id, 'checkOut', entity.checkOut)}
          {text('Category', 'stayItem', entity.id, 'category', entity.category)}
          {text('Confirmation', 'stayItem', entity.id, 'confirmationCode', entity.confirmationCode)}
          {textarea('Summary', 'stayItem', entity.id, 'summary', entity.summary)}
          {textarea('Note', 'stayItem', entity.id, 'note', entity.note)}
        </>
      )
      break
    case 'location':
      fields = (
        <>
          {text('Title', 'location', entity.id, 'title', entity.title)}
          {text('Address', 'location', entity.id, 'address', entity.address)}
          {text('Category', 'location', entity.id, 'category', entity.category)}
          {textarea('Note', 'location', entity.id, 'note', entity.note)}
        </>
      )
      break
    case 'route':
      fields = (
        <>
          {text('Title', 'route', entity.id, 'title', entity.title)}
          {select('Family', 'route', entity.id, 'familyId', entity.familyId, familyOptions)}
          {select('Destination', 'route', entity.id, 'destinationLocationId', entity.destinationLocationId, locationOptions)}
          {select('Day', 'route', entity.id, 'dayId', entity.dayId, dayOptions)}
          {text('Distance', 'route', entity.id, 'distanceText', entity.distanceText)}
          {text('Duration', 'route', entity.id, 'durationText', entity.durationText)}
        </>
      )
      break
    case 'itineraryItem':
      fields = (
        <>
          {text('Title', 'itineraryItem', entity.id, 'title', entity.title)}
          {select('Day', 'itineraryItem', entity.id, 'dayId', entity.dayId, dayOptions)}
          {number('Start slot', 'itineraryItem', entity.id, 'startSlot', entity.startSlot)}
          {number('Span', 'itineraryItem', entity.id, 'span', entity.span)}
          {select('Location', 'itineraryItem', entity.id, 'locationId', entity.locationId, locationOptions)}
          {text('Status', 'itineraryItem', entity.id, 'status', entity.status)}
          {text('Risk level', 'itineraryItem', entity.id, 'riskLevel', entity.riskLevel)}
        </>
      )
      break
    case 'meal':
      fields = (
        <>
          {text('Title', 'meal', entity.id, 'title', entity.title)}
          {select('Day', 'meal', entity.id, 'dayId', entity.dayId, dayOptions)}
          {text('Time label', 'meal', entity.id, 'timeLabel', entity.timeLabel)}
          {select('Location', 'meal', entity.id, 'locationId', entity.locationId, locationOptions)}
          {text('Status', 'meal', entity.id, 'status', entity.status)}
          {text('Reservation type', 'meal', entity.id, 'reservationType', entity.reservationType)}
          {textarea('Note', 'meal', entity.id, 'note', entity.note)}
        </>
      )
      break
    case 'activity':
      fields = (
        <>
          {text('Title', 'activity', entity.id, 'title', entity.title)}
          {select('Day', 'activity', entity.id, 'dayId', entity.dayId, dayOptions)}
          {text('Window', 'activity', entity.id, 'window', entity.window)}
          {select('Location', 'activity', entity.id, 'locationId', entity.locationId, locationOptions)}
          {text('Status', 'activity', entity.id, 'status', entity.status)}
          {textarea('Description', 'activity', entity.id, 'description', entity.description)}
          {textarea('Note', 'activity', entity.id, 'note', entity.note)}
        </>
      )
      break
    case 'expense':
      fields = (
        <>
          {text('Title', 'expense', entity.id, 'title', entity.title)}
          {number('Amount', 'expense', entity.id, 'amount', entity.amount)}
          {text('Payer', 'expense', entity.id, 'payer', entity.payer)}
          {text('Split', 'expense', entity.id, 'split', entity.split)}
          <label className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#8B949E]">
            Settled
            <input
              aria-label="Settled"
              type="checkbox"
              checked={entity.settled}
              disabled={readOnly}
              onChange={(event: ChangeEvent<HTMLInputElement>) => patch('expense', entity.id, { settled: event.target.checked })}
              className="h-4 w-4 accent-[#58A6FF]"
            />
          </label>
          {textarea('Note', 'expense', entity.id, 'note', entity.note)}
        </>
      )
      break
    case 'task':
      fields = (
        <>
          {text('Title', 'task', entity.id, 'title', entity.title)}
          {text('Status', 'task', entity.id, 'status', entity.status)}
          {select('Owner family', 'task', entity.id, 'ownerFamilyId', entity.ownerFamilyId, familyOptions)}
          {select('Day', 'task', entity.id, 'dayId', entity.dayId, dayOptions)}
          {textarea('Note', 'task', entity.id, 'note', entity.note)}
        </>
      )
      break
  }

  return (
    <section aria-label="Selected item editor" className="border border-[#30363D] bg-[#161b22] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">
            Selected item
          </div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
            Editor
          </h3>
        </div>
        {readOnly ? (
          <span className="border border-[#30363D] bg-[#0d1117] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#8B949E]">
            Read only
          </span>
        ) : null}
      </div>
      <div className="grid gap-3">{fields}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#8B949E]">
      <span>{label}</span>
      {children}
    </label>
  )
}

const controlClass =
  'w-full border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] font-medium text-[#C9D1D9] outline-none focus:border-[#58A6FF] disabled:cursor-default disabled:opacity-70'
