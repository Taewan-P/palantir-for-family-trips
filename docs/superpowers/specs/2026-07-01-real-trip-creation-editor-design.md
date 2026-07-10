# Real Trip Creation And Editor Design

Date: 2026-07-01
Status: Approved design, pending implementation plan

## Context

The Cloudflare trip service now supports login, D1-backed trips, invites, shares, and a persisted workspace, but new trips are still created by cloning the seeded Pine Mountain Lake demo document. That makes every new trip start with Parkers, Jiangs, Riveras, sample meals, sample activities, sample expenses, sample routes, and demo copy.

The product needs a real trip creation flow: a user should be able to create their own trip, with their own family units and dates, then edit trip details inside the dashboard.

The existing visual direction remains `DESIGN.md`: dark-only, compact, high-density, grid-disciplined, utilitarian, and semantic color only.

## Goals

- Replace "Create from template" with guided real-trip setup.
- Create new trips without seeded sample families or sample logistics.
- Generate date-based day shells from the chosen trip date range.
- Let owners create family units with display names before accounts are attached.
- Let owners later attach an invited user account to a family unit.
- Make assigned family users trip editors with that family as their default working identity.
- Add a consistent right-side selected-item editor for dashboard details.
- Keep existing sample/template trips readable.
- Verify the full create-and-edit flow manually with Computer Use in Arc.

## Non-Goals

- No per-family-only permissions in this pass. Membership remains trip-scoped.
- No email sending. Invite links remain copyable URLs.
- No migration of existing seeded trips.
- No mobile-first redesign.
- No separate admin CRUD application.
- No full import flow for flights, reservations, or external itinerary files.

## Selected Approach

Use a guided skeleton setup plus a right-side selected-item editor.

The guided setup collects only the minimum data needed to open a real dashboard:

- trip title
- start date
- end date
- destination or basecamp name
- optional basecamp address
- family units, each with display name, origin, adult count, and kid count

The Worker creates a blank `TripDocument` from this payload. The document includes the family units, date-based day shells, and an optional basecamp location/stay shell. All operational collections that previously came from demo data start empty: routes, itinerary items, meals, activities, expenses, and tasks.

The dashboard remains the main editing surface. Clicking a dashboard item selects it. The right rail shows compact editable fields for the selected item, while trip access/settings remain in their own zone.

## Product Flow

### Trip List

`/trips` shows the user's existing trips and a `New trip` action. The action opens a compact guided setup panel instead of immediately creating a seeded trip.

The setup panel should feel like an operations form, not onboarding marketing:

- dense labeled rows
- sharp borders
- small uppercase metadata labels
- mono numerics for dates and counts
- semantic red only for validation errors

### Guided Setup

The owner enters the trip skeleton and at least one family unit.

Validation:

- title is required
- start date is required
- end date is required
- end date cannot be before start date
- destination/basecamp name is required
- at least one family is required
- each family display name is required
- adult and kid counts are non-negative integers
- date range is capped at 31 days for this pass

On success, the app creates the trip and navigates to `/trips/:tripId`.

### New Workspace State

The opened workspace has real structure but no fake content:

- header uses the real trip title
- family switcher uses the created family display names
- itinerary shows one day shell per trip date with empty states
- stay shows the basecamp shell if provided
- meals, activities, expenses, routes, and tasks show empty states and add actions
- no Parkers/Jiangs/Riveras/sample copy appears unless the user created those names

## Family Account Assignment

Families are trip units first and account-linked later.

During setup, a family is display-only. Later, an owner can attach an invited account to a family from trip settings.

Assignment behavior:

- the selected user becomes or remains an `editor` member of the trip
- the user is linked to the family unit
- when that user opens the workspace, their default "working as" identity is that family
- all editors can still edit the whole trip

This keeps the current trip-scoped access model and avoids a larger permission rewrite.

Storage:

- membership remains in the D1 `memberships` table
- family assignment lives on the `FamilyEntity` inside the trip document
- add `assignedUserId?: string | null` and `assignedUserEmail?: string | null` to `FamilyEntity`
- account assignment is persisted through an `entity.update` event on the family

No new database table is needed for this pass.

## Right-Side Selected Item Editor

The right rail should have two clear zones:

1. Selected item editor
2. Trip settings and access

The selected item editor appears when the user selects a family, day shell, stay/basecamp, itinerary item, meal, activity, expense, route, or task.

Editor fields should be compact and type-specific:

- family: display name, origin, short origin, adults, kids, note, assigned account
- day shell: label, date, note
- stay/basecamp: title, category, summary, location, address, access note, parking note, note
- itinerary item: title, day, start, span, status, risk, linked family, note
- meal: title, day, time, owner, location, reservation type, status, note
- activity: title, day/window, status, location, risk, description, fallback, note
- expense: title, payer, amount, split mode, allocations, settled status, note
- route: title, family, origin, stops, destination, note
- task: title, owner/link, day, status, note

All edits should use the existing event model:

- `entity.update` for entity fields
- `pageNote.update` for page notes
- `entity.create` for new blank records
- `entity.delete` for safe deletes
- `trip.meta.update` for title changes

Read-only shared views must render the same rail without editable controls.

## API Changes

`POST /api/trips` should accept a guided setup payload:

```ts
type CreateGuidedTripRequest = {
  title: string
  startDate: string
  endDate: string
  destinationName: string
  basecampAddress?: string
  families: Array<{
    displayName: string
    origin?: string
    adults: number
    kids: number
  }>
}
```

The response can keep the current shape:

```ts
type CreateTripResponse = {
  trip: {
    id: string
    title: string
    role: 'owner'
    currentVersion: 0
  }
}
```

The Worker validates the payload, creates the trip row, creates the owner membership, creates the blank guided `TripDocument`, and stores version `0` as the initial snapshot.

## Document Factory

Add a guided trip factory next to the current template factory:

- keep `createTripFromTemplate` for tests, demos, and existing sample flows
- add a new factory for real guided trips
- use generated IDs for all created families, day shells, location, and stay shell
- keep UI defaults stable: search empty, first family selected, first page useful

The generated document must not copy nested arrays or seeded data from the demo document.

## Empty States And Add Actions

Empty collections should say what is missing and provide one compact action:

- "No meals planned" plus `Add meal`
- "No activities planned" plus `Add activity`
- "No expenses tracked" plus `Add expense`
- "No routes planned" plus `Add route`
- "No tasks linked" plus `Add task`

Add actions create minimal blank records tied to the current context where possible:

- current day if a day shell is selected
- current family if a family identity is active
- basecamp location for stay-related records when available

## Error Handling

Frontend validation should prevent obvious invalid submissions before calling the Worker.

Worker validation remains authoritative:

- invalid setup payload returns `400`
- unauthenticated create returns `401`
- unexpected server errors return `500` without leaking secrets

If trip creation fails, the setup panel keeps the entered values and shows the error in the form.

If an editor command fails, the selected item editor should keep the user's current draft until the room sends the current snapshot or rejection state.

## Testing

Automated checks:

- guided trip factory creates no seeded family names or sample logistics
- guided trip factory creates the correct number of day shells
- guided trip factory creates basecamp location/stay shell when provided
- Worker validates `POST /api/trips` guided payload
- Worker rejects invalid dates, empty families, and invalid counts
- Trips page submits guided setup and navigates to the new trip
- selected-item editor updates at least family, stay/basecamp, meal or activity, and expense fields
- read-only share mode disables editor controls
- full `npm run cf:build`

Manual Computer Use flow required before completion:

- open the local app in Arc
- create a trip from guided setup with custom title, dates, basecamp, and custom families
- confirm no Parkers/Jiangs/Riveras or sample itinerary content appears
- open the dashboard
- click family, day/stay, activity or meal, and expense records
- edit details in the right-side editor
- verify changes persist after navigation and reload
- create invite/share only after the trip uses real data

## Rollout

This is an additive correction.

Existing sample/template trips remain readable and editable. New trips use the guided blank creation flow. No database migration is required for this pass.
