# Real Trip Creation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo-only trip creation path with a real guided trip setup, persist blank multi-trip documents in Cloudflare D1, and add a right-side selected-item editor so owners and invited editors can create and edit trip data for trips they can access.

**Architecture:** Keep Cloudflare Worker APIs authoritative for creation and access control. Store trip content in the existing event-sourced trip document snapshot model. Add a guided document factory that creates date-based day shells, display-name family units, optional basecamp stay data, and empty operational collections. Add UI day helpers so dashboards use document days with legacy seed fallbacks. Add a selected-item editor inside the existing inspector rail and reuse existing `entity.create`, `entity.update`, `entity.delete`, `pageNote.update`, and `trip.meta.update` commands.

**Tech Stack:** Strict TypeScript, React, Vite, Tailwind CSS, Lucide React, Cloudflare Workers, Cloudflare Pages, Cloudflare D1, Vitest, Computer Use manual QA.

---

## File Structure

Files to create:

```
src/app/GuidedTripSetupForm.tsx
src/app/__tests__/GuidedTripSetupForm.test.tsx
src/components/SelectedItemEditor.tsx
src/components/__tests__/SelectedItemEditor.test.tsx
src/__tests__/AppGuidedTrip.test.tsx
```

Files to modify:

```
src/shared/trip-types.ts
src/shared/trip-template.ts
src/shared/__tests__/trip-template.test.ts
worker/index.ts
worker/__tests__/api.test.ts
src/app/TripsPage.tsx
src/app/__tests__/TripsPage.test.tsx
src/tripModel.ts
src/CommandMap.tsx
src/App.tsx
src/InspectorRail.tsx
src/components/EntityCrudPanel.tsx
src/__tests__/AppReadOnly.test.tsx
```

Reference documents:

```
DESIGN.md
docs/superpowers/specs/2026-07-01-real-trip-creation-editor-design.md
```

---

## Task 1: Add Guided Trip Document Types And Factory

Goal: Add strict shared types and a factory that creates real blank trip documents without seeded family names or operational demo data.

### Tests First

- [ ] Add guided factory tests in `src/shared/__tests__/trip-template.test.ts`.

Add test cases:

```ts
import { createGuidedTripDocument } from '../trip-template'

describe('createGuidedTripDocument', () => {
  it('creates a blank trip document from guided setup input', () => {
    const doc = createGuidedTripDocument({
      title: 'Japan Summer 2026',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      basecampAddress: '1 Chome Marunouchi, Tokyo',
      families: [
        { displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 },
        { displayName: 'Kim Household', origin: 'Busan', adults: 1, kids: 2 },
      ],
    })

    expect(doc.title).toBe('Japan Summer 2026')
    expect(doc.templateKind).toBe('guided')
    expect(doc.days).toHaveLength(3)
    expect(doc.days?.map((day) => day.date)).toEqual([
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ])
    expect(doc.families.map((family) => family.title)).toEqual([
      'Park Household',
      'Kim Household',
    ])
    expect(doc.locations.some((location) => location.title === 'Tokyo')).toBe(true)
    expect(doc.stays.some((stay) => stay.title === 'Tokyo Basecamp')).toBe(true)
    expect(doc.routes).toEqual([])
    expect(doc.itineraryItems).toEqual([])
    expect(doc.meals).toEqual([])
    expect(doc.activities).toEqual([])
    expect(doc.expenses).toEqual([])
    expect(doc.tasks).toEqual([])
  })

  it('does not include seeded names or copied demo content', () => {
    const serialized = JSON.stringify(
      createGuidedTripDocument({
        title: 'Real Trip',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        destinationName: 'Osaka',
        families: [{ displayName: 'Lee Family', adults: 2, kids: 0 }],
      }),
    )

    expect(serialized).not.toContain('Parkers')
    expect(serialized).not.toContain('Jiangs')
    expect(serialized).not.toContain('Riveras')
    expect(serialized).not.toContain('Duckfat')
    expect(serialized).not.toContain('Portland Head Light')
  })
})
```

- [ ] Run the focused test and confirm it fails because `createGuidedTripDocument`, `templateKind`, and `days` do not exist yet.

Command:

```
npm run test -- src/shared/__tests__/trip-template.test.ts
```

### Implementation

- [ ] Update `src/shared/trip-types.ts`.

Add document and setup types:

```ts
export type TripTemplateKind = 'seeded' | 'guided'

export type TripDay = {
  id: string
  date: string
  title: string
  shortLabel: string
  code: string
}

export type GuidedTripFamilyInput = {
  displayName: string
  origin?: string
  adults: number
  kids: number
}

export type CreateGuidedTripRequest = {
  title: string
  startDate: string
  endDate: string
  destinationName: string
  basecampAddress?: string
  families: GuidedTripFamilyInput[]
}
```

- [ ] Add family account assignment fields to `FamilyEntity`:

```ts
assignedUserId?: string | null
assignedUserEmail?: string | null
```

- [ ] Add optional document metadata to `TripDocument`:

```ts
templateKind?: TripTemplateKind
days?: TripDay[]
```

Keep `days` optional so existing persisted seed snapshots keep loading.

- [ ] Update `src/shared/trip-template.ts`.

Add these helpers near the existing factory helpers:

```ts
const DAY_MS = 24 * 60 * 60 * 1000

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }
  return date
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildTripDays(startDate: string, endDate: string): TripDay[] {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  const days: TripDay[] = []

  for (let time = start.getTime(), index = 0; time <= end.getTime(); time += DAY_MS, index += 1) {
    const date = new Date(time)
    const iso = formatDateOnly(date)
    const weekday = date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })
    const monthDay = date.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    })

    days.push({
      id: `day_${iso.replaceAll('-', '_')}`,
      date: iso,
      title: `${weekday}, ${monthDay}`,
      shortLabel: `${weekday} ${monthDay}`,
      code: `D${index + 1}`,
    })
  }

  return days
}

function formatHeadcount(adults: number, kids: number): string {
  const adultLabel = adults === 1 ? 'adult' : 'adults'
  const kidLabel = kids === 1 ? 'kid' : 'kids'
  return `${adults} ${adultLabel}, ${kids} ${kidLabel}`
}
```

- [ ] Add `createGuidedTripDocument(input: CreateGuidedTripRequest): TripDocument`.

Implementation rules:

- Use `buildTripDays(input.startDate, input.endDate)` for document day shells.
- Create one `FamilyEntity` per guided family.
- Use display names exactly as entered after trimming.
- Set `assignedUserId` and `assignedUserEmail` to `null`.
- Set `headcount` with `formatHeadcount`.
- Set `origin` from the provided value or `'Unspecified origin'`.
- Create a destination `LocationEntity` for `destinationName`.
- Create a basecamp stay if `destinationName` is present. The title is `${destinationName} Basecamp`; address is `basecampAddress` if provided.
- Set `routes`, `itineraryItems`, `meals`, `activities`, `expenses`, and `tasks` to empty arrays.
- Initialize notes and UI state without seed content.
- Set `templateKind: 'guided'`.
- Set the initial selected page to `families` and the initial selection to the first created family.

- [ ] Set `templateKind: 'seeded'` inside the existing `createTripFromTemplate` path so legacy demo trips can still be identified.

### Verify

- [ ] Re-run:

```
npm run test -- src/shared/__tests__/trip-template.test.ts
```

Expected result: all trip-template tests pass.

- [ ] Commit this task:

```
git add src/shared/trip-types.ts src/shared/trip-template.ts src/shared/__tests__/trip-template.test.ts
git commit -m "Add guided trip document factory"
```

---

## Task 2: Validate Guided Trip Creation In The Worker

Goal: Make `POST /api/trips` accept the guided setup payload, validate it, create a guided trip document, and keep membership-based authorization unchanged.

### Tests First

- [ ] Update `worker/__tests__/api.test.ts`.

Add tests that cover:

- Successful guided trip creation stores a trip, owner membership, and initial snapshot.
- Response body remains `{ trip: { id, title, role: 'owner', currentVersion: 0 } }`.
- Snapshot JSON has `templateKind: 'guided'`.
- Snapshot JSON has `days` from start through end inclusive.
- Snapshot JSON has no seeded family names or seeded operational records.
- Invalid date order returns `400`.
- Missing families returns `400`.
- Negative adults or kids returns `400`.
- More than 31 days returns `400`.

Use this request payload in the success test:

```ts
const payload = {
  title: 'Japan Summer 2026',
  startDate: '2026-07-10',
  endDate: '2026-07-12',
  destinationName: 'Tokyo',
  basecampAddress: '1 Chome Marunouchi, Tokyo',
  families: [
    { displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 },
    { displayName: 'Kim Household', origin: 'Busan', adults: 1, kids: 2 },
  ],
}
```

- [ ] Run:

```
npm run test -- worker/__tests__/api.test.ts
```

Expected result: new tests fail because the Worker still reads only `title`.

### Implementation

- [ ] Update imports in `worker/index.ts`:

```ts
import { createGuidedTripDocument } from '../src/shared/trip-template'
import type { CreateGuidedTripRequest } from '../src/shared/trip-types'
```

- [ ] Replace the current title-only parser with `readGuidedTripRequest(request: Request): Promise<CreateGuidedTripRequest>`.

Validation rules:

- `title` trimmed length between 1 and 120.
- `startDate` and `endDate` match `YYYY-MM-DD` and parse as valid calendar dates.
- `endDate` is on or after `startDate`.
- Inclusive day count is between 1 and 31.
- `destinationName` trimmed length between 1 and 120.
- `basecampAddress` trimmed length at most 240 when provided.
- `families` length between 1 and 12.
- Each `displayName` trimmed length between 1 and 80.
- Each `origin` trimmed length at most 120 when provided.
- `adults` and `kids` are integers between 0 and 20.
- Each family has `adults + kids >= 1`.

Return clean, trimmed values from the parser.

- [ ] In the `POST /api/trips` handler, replace:

```ts
const title = await readTripTitle(request)
const document = createTripFromTemplate({ title })
```

with:

```ts
const input = await readGuidedTripRequest(request)
const document = createGuidedTripDocument(input)
const title = input.title
```

- [ ] Preserve all existing session, owner membership, initial snapshot, and response behavior.

### Verify

- [ ] Run:

```
npm run test -- worker/__tests__/api.test.ts
```

Expected result: Worker API tests pass.

- [ ] Run:

```
npm run cf:build
```

Expected result: TypeScript and Cloudflare build pass.

- [ ] Commit this task:

```
git add worker/index.ts worker/__tests__/api.test.ts
git commit -m "Create guided trips through Worker API"
```

---

## Task 3: Add Guided Trip Setup UI

Goal: Replace the one-click seeded trip action with a compact guided setup flow that lets the user create a real trip with dates, basecamp, and family units.

### Tests First

- [ ] Create `src/app/__tests__/GuidedTripSetupForm.test.tsx`.

Test cases:

- Renders fields for title, start date, end date, destination, basecamp address, and first family.
- Allows adding and removing family rows.
- Submits a `CreateGuidedTripRequest` payload with trimmed values.
- Blocks submit when title, destination, dates, or family name are missing.
- Blocks submit when end date is before start date.

- [ ] Update `src/app/__tests__/TripsPage.test.tsx`.

Replace expectations for the old `Create from template` action with:

- Trips page opens the guided setup panel.
- Submitting the form calls `fetch('/api/trips', { method: 'POST', ... })`.
- Payload matches the guided request.
- After a successful response, navigation goes to `/trips/<id>`.

- [ ] Run:

```
npm run test -- src/app/__tests__/GuidedTripSetupForm.test.tsx src/app/__tests__/TripsPage.test.tsx
```

Expected result: tests fail because the form does not exist and the page still posts a title-only request.

### Implementation

- [ ] Create `src/app/GuidedTripSetupForm.tsx`.

Component API:

```ts
import type { CreateGuidedTripRequest } from '../shared/trip-types'

type GuidedTripSetupFormProps = {
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (request: CreateGuidedTripRequest) => Promise<void> | void
}
```

UI rules from `DESIGN.md`:

- Dark-only surface.
- Compact controls and dense spacing.
- No marketing hero layout.
- Use restrained borders, semantic status only, and monospace text for date-like operational values.
- Use Lucide icons for add, remove, cancel, and submit actions.
- Keep form content within a right-side or centered operational panel, not a nested card stack.

Form behavior:

- Defaults:
  - `title`: empty string.
  - `startDate`: today in local date input format.
  - `endDate`: same as start date.
  - `destinationName`: empty string.
  - `basecampAddress`: empty string.
  - one family row with empty `displayName`, empty `origin`, `adults: 1`, `kids: 0`.
- Add family appends the same default family shape.
- Remove family disabled when only one family remains.
- Submit constructs a trimmed `CreateGuidedTripRequest`.
- Client validation mirrors Worker messages for missing required fields and date ordering.

- [ ] Update `src/app/TripsPage.tsx`.

Implementation details:

- Replace `createTrip()` button copy with `New trip`.
- Clicking `New trip` opens `GuidedTripSetupForm`.
- Submit posts the guided payload to `/api/trips`.
- Keep existing loading, error, and navigation behavior.
- Keep list rendering for existing trips unchanged.
- Remove any UI text that implies every new trip comes from a template.

### Verify

- [ ] Run:

```
npm run test -- src/app/__tests__/GuidedTripSetupForm.test.tsx src/app/__tests__/TripsPage.test.tsx
```

Expected result: guided setup UI tests pass.

- [ ] Run:

```
npm run cf:build
```

Expected result: build passes.

- [ ] Commit this task:

```
git add src/app/GuidedTripSetupForm.tsx src/app/TripsPage.tsx src/app/__tests__/GuidedTripSetupForm.test.tsx src/app/__tests__/TripsPage.test.tsx
git commit -m "Add guided trip setup UI"
```

---

## Task 4: Use Document Day Shells Across The Dashboard

Goal: Make the dashboard render guided trip dates instead of the hardcoded demo `DAYS`, while preserving the current seed trip experience.

### Tests First

- [ ] Create `src/__tests__/AppGuidedTrip.test.tsx`.

Add tests that mount the app with a guided document and assert:

- The command map and day navigation render guided dates.
- The itinerary page shows guided day shells.
- Hardcoded seed day labels do not appear for guided documents.
- Existing seed document tests still pass through fallback days.

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx
```

Expected result: tests fail because UI still reads `DAYS` directly.

### Implementation

- [ ] Update `src/tripModel.ts`.

Add helpers:

```ts
import { DAYS } from './tripData'
import type { TripDay, TripDocument } from './shared/trip-types'

export function getTripDays(document: Pick<TripDocument, 'days'> | null | undefined): TripDay[] {
  return document?.days?.length ? document.days : DAYS
}

export function getTripDayMeta(
  document: Pick<TripDocument, 'days'> | null | undefined,
  dayId: string,
): TripDay | undefined {
  return getTripDays(document).find((day) => day.id === dayId)
}
```

- [ ] Update `src/App.tsx`.

Implementation details:

- Compute `const tripDays = useMemo(() => getTripDays(doc), [doc.days])`.
- Replace `DAYS.map`, `DAYS.find`, `DAYS.length`, and `DAYS[0]` reads with `tripDays` equivalents.
- Replace helper calls that infer day labels from the hardcoded list with document-aware helpers.
- Pass `tripDays` to child components that render day tabs, command map entries, timeline groups, and day selectors.
- When a selected day id no longer exists in the guided document, fall back to `tripDays[0]?.id`.

- [ ] Update `src/CommandMap.tsx`.

Add a prop:

```ts
type CommandMapProps = {
  days: TripDay[]
  ...
}
```

Use the supplied `days` instead of importing or reading hardcoded `DAYS`.

- [ ] Keep legacy seed behavior by passing `getTripDays(doc)` everywhere and retaining fallback only in `tripModel.ts`.

### Verify

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx
```

Expected result: guided day tests pass.

- [ ] Run existing app tests:

```
npm run test -- src/__tests__/AppReadOnly.test.tsx src/app/__tests__/TripSettingsPanel.test.tsx src/app/__tests__/TripWorkspace.test.tsx
```

Expected result: existing dashboard tests pass.

- [ ] Commit this task:

```
git add src/tripModel.ts src/App.tsx src/CommandMap.tsx src/__tests__/AppGuidedTrip.test.tsx
git commit -m "Render dashboard from trip document days"
```

---

## Task 5: Prevent Demo Backfill From Mutating Guided Trips

Goal: Stop seed-only refresh effects from injecting demo routes, seeded plan text, or sample content into guided trip documents.

### Tests First

- [ ] Extend `src/__tests__/AppGuidedTrip.test.tsx`.

Add assertions after mounting a guided document:

- No routes are auto-created.
- No itinerary items are auto-created.
- No page notes receive seed text.
- Saving a guided document after mount preserves empty operational collections.

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx
```

Expected result: tests expose any seed refresh effects that still run on guided documents.

### Implementation

- [ ] Update `src/App.tsx`.

Find effects and helpers that backfill or refresh seeded plan data from hardcoded demo ids.

Add an early return to seed-only effects:

```ts
if (doc.templateKind === 'guided') {
  return
}
```

Apply this guard to:

- Route backfill from demo family route summaries.
- Seeded itinerary/page note refresh.
- Any hardcoded family, stay, route, meal, activity, or expense synchronization that uses seed ids from `tripData.ts`.

- [ ] Keep effects active for documents without `templateKind` so older local demo snapshots continue to work.

### Verify

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx
```

Expected result: guided documents remain blank after dashboard mount.

- [ ] Run:

```
npm run cf:build
```

Expected result: build passes.

- [ ] Commit this task:

```
git add src/App.tsx src/__tests__/AppGuidedTrip.test.tsx
git commit -m "Skip seed backfills for guided trips"
```

---

## Task 6: Add The Right-Side Selected Item Editor

Goal: Let users click any supported item and edit its details in one consistent inspector rail panel. Read-only share links must display the selected item without enabled edit controls.

### Tests First

- [ ] Create `src/components/__tests__/SelectedItemEditor.test.tsx`.

Test cases:

- Family editor updates display name, origin, headcount, and assigned member account.
- Stay editor updates title, address, start day, and end day.
- Meal editor updates title, day, time, location, status, and notes.
- Activity editor updates title, day, time, location, status, and notes.
- Expense editor updates title, amount, payer, split group, settled state, and notes.
- Read-only mode renders values and disables inputs.

- [ ] Extend `src/__tests__/AppReadOnly.test.tsx`.

Add an assertion that selected editor controls are disabled for read-only share access.

- [ ] Run:

```
npm run test -- src/components/__tests__/SelectedItemEditor.test.tsx src/__tests__/AppReadOnly.test.tsx
```

Expected result: tests fail because the selected editor component does not exist.

### Implementation

- [ ] Create `src/components/SelectedItemEditor.tsx`.

Component API:

```ts
import type {
  EntityByType,
  FamilyEntity,
  TripDay,
  TripDocument,
  TripEntity,
  TripEntityType,
} from '../shared/trip-types'

export type SelectedItemMember = {
  userId: string
  email: string
  name: string
  role: 'owner' | 'editor'
}

type SelectedItemEditorProps = {
  doc: TripDocument
  days: TripDay[]
  entity: TripEntity | null
  members: SelectedItemMember[]
  readOnly: boolean
  onPatchEntity: <Type extends TripEntityType>(
    type: Type,
    id: string,
    patch: Partial<EntityByType[Type]>,
  ) => void
}
```

Field coverage:

- Family:
  - `title`
  - `origin`
  - `headcount`
  - `responsibility`
  - `readiness`
  - `assignedUserId`
  - `assignedUserEmail`
- Stay:
  - `title`
  - `locationId`
  - `startDayId`
  - `endDayId`
  - `confirmation`
  - `status`
- Location:
  - `title`
  - `address`
  - `coordinates`
  - `category`
- Route:
  - `title`
  - `familyId`
  - `fromLocationId`
  - `toLocationId`
  - `distance`
  - `duration`
  - `status`
- Itinerary item:
  - `title`
  - `dayId`
  - `startTime`
  - `endTime`
  - `locationId`
  - `status`
  - `description`
- Meal:
  - `title`
  - `dayId`
  - `time`
  - `locationId`
  - `status`
  - `reservation`
  - `notes`
- Activity:
  - `title`
  - `dayId`
  - `time`
  - `locationId`
  - `status`
  - `notes`
- Expense:
  - `title`
  - `amount`
  - `currency`
  - `payerFamilyId`
  - `splitFamilyIds`
  - `settled`
  - `notes`
- Task:
  - `title`
  - `status`
  - `assigneeFamilyId`
  - `dueDayId`
  - `priority`

For account assignment:

```ts
function buildAssignedUserPatch(
  family: FamilyEntity,
  userId: string,
  members: SelectedItemMember[],
): Pick<FamilyEntity, 'assignedUserId' | 'assignedUserEmail'> {
  const member = members.find((candidate) => candidate.userId === userId)
  return {
    assignedUserId: member?.userId ?? null,
    assignedUserEmail: member?.email ?? null,
  }
}
```

Use one compact editor surface with stable sections:

- Header: selected type and selected title.
- Details fields.
- Assignment fields when applicable.
- Operational fields when applicable.

Use native form controls styled with existing dashboard utility classes. Do not add a new component library.

- [ ] Update `src/InspectorRail.tsx`.

Implementation details:

- Import and render `SelectedItemEditor`.
- Add props:

```ts
members: SelectedItemMember[]
days: TripDay[]
onPatchEntity: <Type extends TripEntityType>(
  type: Type,
  id: string,
  patch: Partial<EntityByType[Type]>,
) => void
```

- Place the editor at the top of the right rail selected-item zone.
- Keep existing notes, tasks, trip settings, access controls, and CRUD panel below it.
- Pass `readOnly` through.

- [ ] Update `src/App.tsx`.

Add an updater that reuses the existing event model:

```ts
const patchEntity = useCallback(
  <Type extends TripEntityType>(
    entityType: Type,
    entityId: string,
    patch: Partial<EntityByType[Type]>,
  ) => {
    if (readOnly) {
      return
    }

    if (
      sendEntityUpdateCommand(entityType, entityId, {
        before: undefined,
        after: patch,
      })
    ) {
      return
    }

    setDoc((current) => updateEntityInDocument(current, entityType, entityId, patch))
  },
  [readOnly, sendEntityUpdateCommand, setDoc],
)
```

Use the local helper name that already exists in `App.tsx` for document entity updates. If the existing helper requires a full entity, compute the next entity from the current document before calling it.

- [ ] Pass `serviceTripMembers`, `tripDays`, and `patchEntity` into `InspectorRail`.

### Verify

- [ ] Run:

```
npm run test -- src/components/__tests__/SelectedItemEditor.test.tsx src/__tests__/AppReadOnly.test.tsx
```

Expected result: selected editor tests pass.

- [ ] Run:

```
npm run cf:build
```

Expected result: build passes.

- [ ] Commit this task:

```
git add src/components/SelectedItemEditor.tsx src/InspectorRail.tsx src/App.tsx src/components/__tests__/SelectedItemEditor.test.tsx src/__tests__/AppReadOnly.test.tsx
git commit -m "Add selected item inspector editor"
```

---

## Task 7: Add Blank-State Add Actions For Real Trips

Goal: Make blank guided trips usable by giving every empty operational page a compact add path instead of showing seed-dependent content.

### Tests First

- [ ] Extend `src/__tests__/AppGuidedTrip.test.tsx`.

Add tests:

- Blank meals page shows an empty state and an add meal action.
- Blank activities page shows an empty state and an add activity action.
- Blank expenses page shows an empty state and an add expense action.
- Blank routes page shows an empty state and an add route action.
- Blank itinerary day shell shows an empty state and an add itinerary item action.
- Clicking each add action creates the entity and selects it for right-rail editing.

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx
```

Expected result: tests fail for missing blank-state add paths.

### Implementation

- [ ] Update page sections in `src/App.tsx`.

For each collection page or section, add a compact empty state when the collection is empty:

```tsx
<div className="rounded border border-dashed border-slate-700/80 bg-slate-950/30 px-3 py-2 text-xs text-slate-400">
  <div className="flex items-center justify-between gap-3">
    <span>No meals planned</span>
    <button type="button" onClick={handleAddMeal}>Add meal</button>
  </div>
</div>
```

Use collection-specific copy:

- `No itinerary items`
- `No meals planned`
- `No activities planned`
- `No expenses tracked`
- `No routes planned`
- `No tasks created`

- [ ] Wire each add action to the existing `createEntity` handler and select the created entity.

Default values:

- Itinerary item:
  - title: `New itinerary item`
  - dayId: selected day id or first document day id
  - status: planning state used by existing type
- Meal:
  - title: `New meal`
  - dayId: selected day id or first document day id
  - status: planning state used by existing type
- Activity:
  - title: `New activity`
  - dayId: selected day id or first document day id
  - status: planning state used by existing type
- Expense:
  - title: `New expense`
  - amount: `0`
  - currency: `USD`
  - settled: `false`
- Route:
  - title: `New route`
  - familyId: active family id or first family id
  - status: planning state used by existing type
- Task:
  - title: `New task`
  - status: open state used by existing type

- [ ] Disable add actions when `readOnly` is true.

### Verify

- [ ] Run:

```
npm run test -- src/__tests__/AppGuidedTrip.test.tsx src/__tests__/AppReadOnly.test.tsx
```

Expected result: guided blank-state and read-only tests pass.

- [ ] Run:

```
npm run cf:build
```

Expected result: build passes.

- [ ] Commit this task:

```
git add src/App.tsx src/__tests__/AppGuidedTrip.test.tsx src/__tests__/AppReadOnly.test.tsx
git commit -m "Add blank-state creation actions"
```

---

## Task 8: Verify Access, Persistence, And Manual Browser Flow

Goal: Prove the implemented service works from trip creation through dashboard editing, persistence, invited-member editing, and read-only share behavior.

### Automated Verification

- [ ] Run all targeted tests from this plan:

```
npm run test -- src/shared/__tests__/trip-template.test.ts worker/__tests__/api.test.ts src/app/__tests__/GuidedTripSetupForm.test.tsx src/app/__tests__/TripsPage.test.tsx src/components/__tests__/SelectedItemEditor.test.tsx src/__tests__/AppGuidedTrip.test.tsx src/__tests__/AppReadOnly.test.tsx
```

Expected result: all targeted tests pass.

- [ ] Run the Cloudflare build:

```
npm run cf:build
```

Expected result: build passes.

### Local Manual QA Setup

- [ ] Start local dev with Cloudflare bindings as used by this repo.

Use the repo's existing local command. If both Vite and Worker processes are required, start both and keep them running until manual QA is complete.

- [ ] Use Computer Use for the browser flow. Open the local app in Arc or the available browser control surface. Use the exact visible UI flow; do not inspect internal state as a substitute for clicking through the app.

Manual flow:

1. Log in locally with Google OAuth or the configured local auth path.
2. Open Trips.
3. Click `New trip`.
4. Create a trip with:
   - title: `Japan Summer 2026`
   - start date: `2026-07-10`
   - end date: `2026-07-12`
   - destination: `Tokyo`
   - basecamp address: `1 Chome Marunouchi, Tokyo`
   - family 1: `Park Household`, origin `Seoul`, adults `2`, kids `1`
   - family 2: `Kim Household`, origin `Busan`, adults `1`, kids `2`
5. Confirm the app navigates to the new dashboard.
6. Confirm no seeded names appear: `Parkers`, `Jiangs`, `Riveras`.
7. Confirm no seeded operational content appears, including `Duckfat` and `Portland Head Light`.
8. Click each guided day and confirm the date labels match July 10 through July 12, 2026.
9. Click the first family. Edit title, origin, and headcount from the right rail. Confirm the page updates.
10. Click the basecamp stay. Edit title and confirmation in the right rail. Confirm the page updates.
11. Add a meal from the blank meals state. Edit title, day, time, location, status, and notes in the right rail.
12. Add an activity from the blank activities state. Edit title, day, time, status, and notes in the right rail.
13. Add an expense from the blank expenses state. Edit title, amount, payer, split, settled state, and notes in the right rail.
14. Navigate away from the trip and back to it. Confirm all edits persist.
15. Reload the browser. Confirm all edits persist.
16. Invite a second account as editor using the access controls.
17. As the second account, open the trip and confirm editing is allowed only on the invited trip.
18. Assign the second account to one family from the owner account.
19. As the second account, confirm the family assignment is visible and the default working identity is that family where the UI displays family context.
20. Create a read-only share link. Open it in a signed-out or separate browser context. Confirm right-rail editor controls are disabled and add actions are disabled.

### Final Verification

- [ ] Run:

```
git status --short
```

Expected result: only intentional tracked changes from this plan are present.

- [ ] Run:

```
npm run cf:build
```

Expected result: build passes after manual QA edits and final code changes.

- [ ] Commit final fixes if manual QA found issues:

```
git add .
git commit -m "Polish real trip creation flow"
```

---

## Acceptance Criteria

- [ ] `POST /api/trips` requires and validates guided setup data.
- [ ] New trips can be created with custom title, date range, destination, basecamp, and any number of family units within validation limits.
- [ ] New trip documents contain guided family units and date shells, with no seeded operational records.
- [ ] Multiple trips can be created and opened independently.
- [ ] Owners and invited editors can edit trips they are members of.
- [ ] Users cannot edit trips they are not invited to.
- [ ] Read-only share links render trip data with disabled editing and creation controls.
- [ ] Owner can assign an invited account to a family entity.
- [ ] Assigned account remains an editor for the whole trip and is displayed as linked to that family.
- [ ] Right-side selected item editor supports family, stay, day-linked operational items, expenses, routes, tasks, and locations.
- [ ] Guided dashboard uses document day shells instead of hardcoded demo days.
- [ ] Cloudflare build passes with strict TypeScript.
- [ ] Computer Use manual QA completes the step-by-step create and edit flow.

---

## Design Constraints

- [ ] Follow `DESIGN.md` for every visual change.
- [ ] Keep information density high.
- [ ] Use dark-only dashboard styling.
- [ ] Use semantic colors only for status, risk, warnings, and success.
- [ ] Use monospace text for dates, times, amounts, counts, coordinates, and ids shown in operational UI.
- [ ] Keep radii small and surfaces compact.
- [ ] Use Lucide React icons where a button represents a tool action.
- [ ] Do not add a landing page, hero, marketing copy, or decorative gradients.
- [ ] Do not add a new design system or styling dependency.

---

## Implementation Notes

- The existing Worker membership model remains the authorization source. Do not add trip content ACL fields.
- The family account assignment is content metadata on `FamilyEntity`, persisted through `entity.update`.
- The guided factory creates the blank document shape. The Worker validates request boundaries before calling it.
- Existing seeded trip code remains available for tests, demos, and legacy snapshots.
- UI day fallback lives in one helper so hardcoded seed days do not spread into guided trip views.
- The right-side editor should be field-focused and compact, not a modal or full-page form.
- When a field edit maps to an existing domain-specific command, keep using that command. Use generic `entity.update` only for fields without a narrower command.
