# Cloudflare Trip Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-trip browser-local dashboard into a strict TypeScript Cloudflare service with Google login, multi-trip D1 persistence, trip-scoped membership, invite links, sanitized share links, event-sourced history, and Durable Object real-time collaboration.

**Architecture:** Keep `TripDocument` as the app state model, store ordered trip events and snapshots in D1, and route live edits through one Durable Object room per trip. Cloudflare Pages serves the React app; a Cloudflare Worker owns API routes, Google auth, D1 access, and Durable Object routing.

**Tech Stack:** React 19, Vite, strict TypeScript, Vitest, Cloudflare Pages, Cloudflare Workers, Durable Objects, D1, WebSockets, Google OpenID Connect, `jose` for ID token verification.

---

## Scope Check

The spec spans auth, database, real-time sync, frontend routing, CRUD, sharing, and deployment. These are coupled by the trip document and membership model, so this plan keeps one staged delivery. Each task produces a testable slice and ends with a commit.

Do not modify or commit the unrelated untracked `AGENTS.md` unless the user asks.

## File Structure

Create or modify these files:

- `package.json`: add TypeScript, test, worker, and Cloudflare scripts.
- `package-lock.json`: update dependency lockfile.
- `tsconfig.json`: strict shared TypeScript config.
- `tsconfig.worker.json`: Worker-specific TypeScript config.
- `vitest.config.ts`: test config for browser-like shared/frontend tests.
- `vitest.worker.config.ts`: test config for Worker logic.
- `vite.config.ts`: Vite config with React and local API proxy.
- `wrangler.toml`: Worker, D1, Durable Object, and local dev bindings.
- `migrations/0001_init.sql`: D1 schema.
- `.env.example`: Google, session, API, and Cloudflare binding notes.
- `src/shared/json.ts`: JSON-compatible types.
- `src/shared/result.ts`: small API result helpers.
- `src/shared/ids.ts`: ID and token helpers.
- `src/shared/trip-types.ts`: strict shared trip document and entity types.
- `src/shared/trip-events.ts`: event and command unions.
- `src/shared/trip-reducer.ts`: pure reducer for applying events to trip documents.
- `src/shared/trip-sanitizer.ts`: public share projection.
- `src/shared/trip-template.ts`: template creation from the existing seeded model.
- `src/shared/__tests__/*.test.ts`: reducer, sanitizer, ID, and template tests.
- `worker/env.ts`: Worker binding types.
- `worker/http.ts`: JSON responses, cookies, and route matching.
- `worker/auth.ts`: Google OAuth, sessions, token hashing.
- `worker/db.ts`: D1 query helpers and repositories.
- `worker/trip-room.ts`: Durable Object room.
- `worker/index.ts`: Worker entrypoint and API routes.
- `worker/__tests__/*.test.ts`: auth, db SQL, API, and room helper tests.
- `src/app/router.tsx`: tiny pathname router.
- `src/app/api-client.ts`: frontend API client.
- `src/app/useTripRoom.ts`: WebSocket trip room hook.
- `src/app/LoginPage.tsx`: login route.
- `src/app/TripsPage.tsx`: trip list and create-from-template route.
- `src/app/SharePage.tsx`: read-only shared trip route.
- `src/app/TripWorkspace.tsx`: wrapper around the existing dashboard.
- `src/app/TripSettingsPanel.tsx`: members, invites, share link, and trip metadata.
- `src/components/EntityCrudPanel.tsx`: compact CRUD surface for all core entity collections.
- `src/main.tsx`: route entrypoint.
- `src/App.tsx`, `src/CommandMap.tsx`, `src/InspectorRail.tsx`, `src/tripModel.ts`, `src/tripData.ts`, `src/weather.ts`, `src/publishConfig.ts`: TypeScript conversion of existing UI/model files.
- `src/usePersistedTripState.ts`: remove or shrink to harmless UI preference storage after `useTripRoom` is active.
- `README.md`: local dev and deploy instructions.

## Task 1: Install Tooling And Strict TypeScript Baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.worker.json`
- Create: `vitest.config.ts`
- Create: `vitest.worker.config.ts`
- Rename: `vite.config.js` to `vite.config.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/shared/__tests__/tooling-smoke.test.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install jose
npm install -D typescript vitest jsdom @types/react @types/react-dom @cloudflare/workers-types wrangler
```

Expected: `package.json` and `package-lock.json` update with `jose`, `typescript`, `vitest`, `jsdom`, `@types/react`, `@types/react-dom`, `@cloudflare/workers-types`, and `wrangler`.

- [ ] **Step 2: Rename Vite config**

Run:

```bash
git mv vite.config.js vite.config.ts
```

Expected: `git status --short` shows `R  vite.config.js -> vite.config.ts`.

- [ ] **Step 3: Replace `package.json` scripts**

Use this scripts block:

```json
{
  "dev": "vite",
  "dev:worker": "wrangler dev worker/index.ts --local --port 8787",
  "build": "vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit",
  "typecheck:worker": "tsc --noEmit -p tsconfig.worker.json",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:worker": "vitest run -c vitest.worker.config.ts",
  "cf:build": "npm run typecheck && npm run typecheck:worker && npm run test && npm run test:worker && npm run build",
  "cf:deploy": "wrangler deploy"
}
```

- [ ] **Step 4: Create strict app TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "vitest.config.ts"],
  "references": [{ "path": "./tsconfig.worker.json" }]
}
```

- [ ] **Step 5: Create Worker TypeScript config**

Create `tsconfig.worker.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "allowJs": false,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"]
  },
  "include": ["worker/**/*.ts", "src/shared/**/*.ts", "vitest.worker.config.ts"]
}
```

- [ ] **Step 6: Create Vitest configs**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

Create `vitest.worker.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['worker/**/*.test.ts'],
  },
})
```

- [ ] **Step 7: Update Vite config**

Replace `vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
```

- [ ] **Step 8: Add Vite env types**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_GOOGLE_MAP_ID?: string
  readonly VITE_DISABLE_LEGACY_GOOGLE_ROUTING?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_WS_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 9: Add tooling smoke test**

Create `src/shared/__tests__/tooling-smoke.test.ts`:

```ts
describe('tooling smoke', () => {
  it('runs vitest with TypeScript', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 10: Run tests**

Run:

```bash
npm run test
```

Expected: PASS with `tooling smoke`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.worker.json vitest.config.ts vitest.worker.config.ts vite.config.ts src/vite-env.d.ts src/shared/__tests__/tooling-smoke.test.ts
git commit -m "chore: add strict typescript tooling"
```

## Task 2: Shared JSON, ID, And Result Primitives

**Files:**
- Create: `src/shared/json.ts`
- Create: `src/shared/result.ts`
- Create: `src/shared/ids.ts`
- Create: `src/shared/__tests__/ids.test.ts`
- Create: `src/shared/__tests__/result.test.ts`

- [ ] **Step 1: Write ID tests**

Create `src/shared/__tests__/ids.test.ts`:

```ts
import { createId, createToken, timingSafeEqualString } from '../ids'

describe('ids', () => {
  it('creates prefixed ids', () => {
    const id = createId('trip')
    expect(id.startsWith('trip_')).toBe(true)
    expect(id.length).toBeGreaterThan(20)
  })

  it('creates long URL-safe tokens', () => {
    const token = createToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('compares strings without leaking equality through length shortcuts in callers', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true)
    expect(timingSafeEqualString('abc', 'abd')).toBe(false)
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false)
  })
})
```

- [ ] **Step 2: Write result tests**

Create `src/shared/__tests__/result.test.ts`:

```ts
import { err, ok } from '../result'

describe('api result helpers', () => {
  it('creates success envelopes', () => {
    expect(ok({ id: 'trip_1' })).toEqual({ ok: true, data: { id: 'trip_1' } })
  })

  it('creates error envelopes', () => {
    expect(err('forbidden', 'Trip access denied')).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Trip access denied' },
    })
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm run test -- src/shared/__tests__/ids.test.ts src/shared/__tests__/result.test.ts
```

Expected: FAIL because `../ids` and `../result` do not exist.

- [ ] **Step 4: Implement JSON types**

Create `src/shared/json.ts`:

```ts
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonArray = readonly JsonValue[]

export function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 5: Implement result helpers**

Create `src/shared/result.ts`:

```ts
import type { JsonValue } from './json'

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error'

export type ApiSuccess<T extends JsonValue> = {
  ok: true
  data: T
}

export type ApiFailure = {
  ok: false
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type ApiResult<T extends JsonValue> = ApiSuccess<T> | ApiFailure

export function ok<T extends JsonValue>(data: T): ApiSuccess<T> {
  return { ok: true, data }
}

export function err(code: ApiErrorCode, message: string): ApiFailure {
  return { ok: false, error: { code, message } }
}
```

- [ ] **Step 6: Implement ID helpers**

Create `src/shared/ids.ts`:

```ts
const TOKEN_BYTES = 32

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createId(prefix: string): string {
  return `${prefix}_${hex(randomBytes(18))}`
}

export function createToken(): string {
  return hex(randomBytes(TOKEN_BYTES))
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let diff = left.length ^ right.length

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0
    const rightCode = index < right.length ? right.charCodeAt(index) : 0
    diff |= leftCode ^ rightCode
  }

  return diff === 0
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm run test -- src/shared/__tests__/ids.test.ts src/shared/__tests__/result.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/json.ts src/shared/result.ts src/shared/ids.ts src/shared/__tests__/ids.test.ts src/shared/__tests__/result.test.ts
git commit -m "feat: add shared primitives"
```

## Task 3: Trip Types, Events, Reducer, And Sanitizer

**Files:**
- Create: `src/shared/trip-types.ts`
- Create: `src/shared/trip-events.ts`
- Create: `src/shared/trip-reducer.ts`
- Create: `src/shared/trip-sanitizer.ts`
- Create: `src/shared/__tests__/trip-reducer.test.ts`
- Create: `src/shared/__tests__/trip-sanitizer.test.ts`

- [ ] **Step 1: Write reducer tests**

Create `src/shared/__tests__/trip-reducer.test.ts`:

```ts
import { applyTripEvent } from '../trip-reducer'
import type { TripDocument, TripEvent } from '../trip-types'

function baseDoc(): TripDocument {
  return {
    id: 'trip_1',
    title: 'Test Trip',
    selectedPage: 'itinerary',
    selection: { type: 'activity', id: 'activity_1' },
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      searchQuery: '',
      timeline: { mode: 'scenario', cursorSlot: 0 },
      map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
    },
    families: [],
    locations: [],
    routes: [],
    itineraryItems: [],
    meals: [],
    activities: [],
    stayItems: [],
    expenses: [],
    tasks: [],
  }
}

describe('applyTripEvent', () => {
  it('creates an entity in the matching collection', () => {
    const event: TripEvent = {
      id: 'event_1',
      tripId: 'trip_1',
      version: 1,
      previousVersion: 0,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:00:00.000Z',
      type: 'entity.create',
      payload: {
        entityType: 'task',
        entity: {
          id: 'task_1',
          type: 'task',
          title: 'Pack snacks',
          dayId: 'thu',
          status: 'open',
          linkedEntityKeys: [],
          note: '',
        },
      },
    }

    const next = applyTripEvent(baseDoc(), event)

    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]?.title).toBe('Pack snacks')
  })

  it('updates an existing entity', () => {
    const doc = baseDoc()
    doc.tasks = [{
      id: 'task_1',
      type: 'task',
      title: 'Pack snacks',
      dayId: 'thu',
      status: 'open',
      linkedEntityKeys: [],
      note: '',
    }]

    const event: TripEvent = {
      id: 'event_2',
      tripId: 'trip_1',
      version: 2,
      previousVersion: 1,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:01:00.000Z',
      type: 'entity.update',
      payload: { entityType: 'task', id: 'task_1', patch: { status: 'done' } },
    }

    expect(applyTripEvent(doc, event).tasks[0]?.status).toBe('done')
  })

  it('deletes an entity from the matching collection', () => {
    const doc = baseDoc()
    doc.expenses = [{
      id: 'expense_1',
      type: 'expense',
      title: 'Pizza',
      payer: 'Shared',
      amount: 42,
      split: 'Equal split',
      allocationMode: 'equal',
      allocations: {},
      settled: false,
      linkedEntityKeys: [],
      note: '',
    }]

    const event: TripEvent = {
      id: 'event_3',
      tripId: 'trip_1',
      version: 3,
      previousVersion: 2,
      actorUserId: 'user_1',
      createdAt: '2026-07-01T00:02:00.000Z',
      type: 'entity.delete',
      payload: { entityType: 'expense', id: 'expense_1' },
    }

    expect(applyTripEvent(doc, event).expenses).toEqual([])
  })
})
```

- [ ] **Step 2: Write sanitizer tests**

Create `src/shared/__tests__/trip-sanitizer.test.ts`:

```ts
import { sanitizeTripForShare } from '../trip-sanitizer'
import type { TripDocument } from '../trip-types'

describe('sanitizeTripForShare', () => {
  it('removes private lodging and note fields', () => {
    const doc = {
      id: 'trip_1',
      title: 'Private Trip',
      selectedPage: 'stay',
      selection: { type: 'location', id: 'loc_1' },
      pageNotes: { stay: 'Door code is private' },
      pageNoteMeta: {},
      ui: {
        searchQuery: 'door',
        timeline: { mode: 'scenario', cursorSlot: 0 },
        map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
      },
      families: [],
      locations: [{
        id: 'loc_1',
        type: 'location',
        title: 'Cabin',
        category: 'stay',
        dayId: 'all',
        address: '123 Secret Lane',
        coordinates: { lat: 1, lng: 2 },
        accessNote: 'Gate code 1234',
        wifiNetwork: 'private-wifi',
        wifiPassword: 'secret',
        lockNote: 'Key under mat',
        note: 'Owner phone is private',
      }],
      routes: [],
      itineraryItems: [],
      meals: [],
      activities: [],
      stayItems: [],
      expenses: [],
      tasks: [],
    } satisfies TripDocument

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.pageNotes).toEqual({})
    expect(sanitized.ui.searchQuery).toBe('')
    expect(sanitized.locations[0]?.address).toBe('Private lodging details hidden')
    expect(sanitized.locations[0]?.accessNote).toBeNull()
    expect(sanitized.locations[0]?.wifiPassword).toBeNull()
    expect(sanitized.locations[0]?.note).toBe('')
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm run test -- src/shared/__tests__/trip-reducer.test.ts src/shared/__tests__/trip-sanitizer.test.ts
```

Expected: FAIL because trip type modules do not exist.

- [ ] **Step 4: Implement trip types**

Create `src/shared/trip-types.ts`:

```ts
import type { JsonObject, JsonValue } from './json'

export type TripEntityType =
  | 'family'
  | 'location'
  | 'route'
  | 'itineraryItem'
  | 'meal'
  | 'activity'
  | 'stayItem'
  | 'expense'
  | 'task'

export type EntitySelection = {
  type: TripEntityType
  id: string
}

export type Coordinates = {
  lat: number
  lng: number
}

export type BaseEntity = {
  id: string
  type: TripEntityType
  title?: string
  name?: string
  dayId?: string
  note?: string
  linkedEntityKeys?: string[]
  taskIds?: string[]
  createdByFamilyId?: string | null
  createdAt?: string
  lastEditedByFamilyId?: string | null
  lastEditedAt?: string
}

export type FamilyEntity = BaseEntity & {
  type: 'family'
  title: string
  origin?: string
  shortOrigin?: string
  status?: string
  eta?: string
  headcount?: string
  readiness?: number
}

export type LocationEntity = BaseEntity & {
  type: 'location'
  title: string
  category: string
  address?: string
  coordinates?: Coordinates
  accessNote?: string | null
  directionsNote?: string | null
  parkingNote?: string | null
  lockNote?: string | null
  wifiNetwork?: string | null
  wifiPassword?: string | null
  externalUrl?: string | null
  websiteUrl?: string | null
  phoneNumber?: string | null
  [key: string]: JsonValue | undefined
}

export type RouteEntity = BaseEntity & {
  type: 'route'
  title: string
  familyId?: string
  originCoordinates?: Coordinates
  destinationLocationId?: string
  stopLocationIds?: string[]
  path?: Coordinates[]
  linkedEntityKey?: string
  simulationStartSlot?: number
  simulationEndSlot?: number
  durationSeconds?: number
}

export type ItineraryItemEntity = BaseEntity & {
  type: 'itineraryItem'
  title: string
  rowId?: string
  startSlot: number
  span?: number
  routeId?: string
  locationId?: string | null
  familyIds?: string[]
  status?: string
}

export type MealEntity = BaseEntity & {
  type: 'meal'
  title: string
  timeLabel?: string
  startSlot?: number
  status?: string
  owner?: string
  locationId?: string | null
  reservationType?: string
}

export type ActivityEntity = BaseEntity & {
  type: 'activity'
  title: string
  window?: string
  status?: string
  description?: string
  backup?: string
  locationId?: string | null
  riskLevel?: string
  weatherSensitivity?: string
}

export type StayItemEntity = BaseEntity & {
  type: 'stayItem'
  title: string
  category?: string
  summary?: string
}

export type ExpenseEntity = BaseEntity & {
  type: 'expense'
  title: string
  payer: string
  amount: number
  split: string
  allocationMode: 'equal' | 'manual' | 'individual'
  allocations: Record<string, number>
  settled: boolean
}

export type TaskEntity = BaseEntity & {
  type: 'task'
  title: string
  status: 'open' | 'done' | string
  ownerFamilyId?: string | null
}

export type TripEntity =
  | FamilyEntity
  | LocationEntity
  | RouteEntity
  | ItineraryItemEntity
  | MealEntity
  | ActivityEntity
  | StayItemEntity
  | ExpenseEntity
  | TaskEntity

export type TripUiState = {
  searchQuery: string
  timeline: { mode: string; cursorSlot: number }
  map: {
    showRoutes: boolean
    showFacilities: boolean
    showTraffic: boolean
    focusFamilyId: string
    focusDayId: string
  }
}

export type TripDocument = {
  id?: string
  title?: string
  selectedPage: string
  selection: EntitySelection
  pageNotes: Record<string, string>
  pageNoteMeta: Record<string, JsonObject>
  ui: TripUiState
  families: FamilyEntity[]
  locations: LocationEntity[]
  routes: RouteEntity[]
  itineraryItems: ItineraryItemEntity[]
  meals: MealEntity[]
  activities: ActivityEntity[]
  stayItems: StayItemEntity[]
  expenses: ExpenseEntity[]
  tasks: TaskEntity[]
}

export type TripCollectionName =
  | 'families'
  | 'locations'
  | 'routes'
  | 'itineraryItems'
  | 'meals'
  | 'activities'
  | 'stayItems'
  | 'expenses'
  | 'tasks'

export const COLLECTION_BY_ENTITY_TYPE: Record<TripEntityType, TripCollectionName> = {
  family: 'families',
  location: 'locations',
  route: 'routes',
  itineraryItem: 'itineraryItems',
  meal: 'meals',
  activity: 'activities',
  stayItem: 'stayItems',
  expense: 'expenses',
  task: 'tasks',
}

export type TripEvent =
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'entity.create'
      payload: { entityType: TripEntityType; entity: TripEntity }
    }
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'entity.update'
      payload: { entityType: TripEntityType; id: string; patch: Partial<TripEntity> }
    }
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'entity.delete'
      payload: { entityType: TripEntityType; id: string }
    }
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'pageNote.update'
      payload: { pageId: string; value: string }
    }
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'uiState.update'
      payload: Partial<TripUiState>
    }
  | {
      id: string
      tripId: string
      version: number
      previousVersion: number
      actorUserId: string
      createdAt: string
      type: 'trip.meta.update'
      payload: { title?: string }
    }
```

- [ ] **Step 5: Implement event exports**

Create `src/shared/trip-events.ts`:

```ts
export type { TripEvent } from './trip-types'
```

- [ ] **Step 6: Implement reducer**

Create `src/shared/trip-reducer.ts`:

```ts
import { COLLECTION_BY_ENTITY_TYPE, type TripDocument, type TripEntity, type TripEvent } from './trip-types'

export function applyTripEvent(document: TripDocument, event: TripEvent): TripDocument {
  if (event.type === 'entity.create') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: [...collection, event.payload.entity],
    }
  }

  if (event.type === 'entity.update') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: collection.map((entity) =>
        entity.id === event.payload.id ? ({ ...entity, ...event.payload.patch } as TripEntity) : entity,
      ),
    }
  }

  if (event.type === 'entity.delete') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: collection.filter((entity) => entity.id !== event.payload.id),
    }
  }

  if (event.type === 'pageNote.update') {
    return {
      ...document,
      pageNotes: {
        ...document.pageNotes,
        [event.payload.pageId]: event.payload.value,
      },
    }
  }

  if (event.type === 'uiState.update') {
    return {
      ...document,
      ui: {
        ...document.ui,
        ...event.payload,
        timeline: { ...document.ui.timeline, ...event.payload.timeline },
        map: { ...document.ui.map, ...event.payload.map },
      },
    }
  }

  return {
    ...document,
    title: event.payload.title ?? document.title,
  }
}

export function replayTripEvents(document: TripDocument, events: readonly TripEvent[]): TripDocument {
  return events.reduce((current, event) => applyTripEvent(current, event), document)
}
```

- [ ] **Step 7: Implement sanitizer**

Create `src/shared/trip-sanitizer.ts`:

```ts
import type { LocationEntity, TripDocument } from './trip-types'

function sanitizeLocation(location: LocationEntity): LocationEntity {
  if (location.category !== 'stay') {
    return { ...location, note: '' }
  }

  return {
    ...location,
    address: 'Private lodging details hidden',
    accessNote: null,
    directionsNote: null,
    parkingNote: null,
    lockNote: null,
    wifiNetwork: null,
    wifiPassword: null,
    note: '',
  }
}

export function sanitizeTripForShare(document: TripDocument): TripDocument {
  return {
    ...document,
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      ...document.ui,
      searchQuery: '',
    },
    families: document.families.map((family) => ({ ...family, note: '' })),
    locations: document.locations.map(sanitizeLocation),
    routes: document.routes.map((route) => ({ ...route, note: '' })),
    itineraryItems: document.itineraryItems.map((item) => ({ ...item, note: '' })),
    meals: document.meals.map((meal) => ({ ...meal, note: '' })),
    activities: document.activities.map((activity) => ({ ...activity, note: '' })),
    stayItems: document.stayItems.map((item) => ({ ...item, note: '' })),
    expenses: document.expenses.map((expense) => ({ ...expense, note: '', allocations: {} })),
    tasks: document.tasks.map((task) => ({ ...task, note: '' })),
  }
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
npm run test -- src/shared/__tests__/trip-reducer.test.ts src/shared/__tests__/trip-sanitizer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/trip-types.ts src/shared/trip-events.ts src/shared/trip-reducer.ts src/shared/trip-sanitizer.ts src/shared/__tests__/trip-reducer.test.ts src/shared/__tests__/trip-sanitizer.test.ts
git commit -m "feat: add trip event model"
```

## Task 4: Convert Existing Trip Template To Typed Shared Module

**Files:**
- Rename: `src/tripData.js` to `src/tripData.ts`
- Rename: `src/tripModel.js` to `src/tripModel.ts`
- Create: `src/shared/trip-template.ts`
- Create: `src/shared/__tests__/trip-template.test.ts`
- Modify: imports in `src/App.jsx`, `src/CommandMap.jsx`, `src/InspectorRail.jsx`

- [ ] **Step 1: Write template test**

Create `src/shared/__tests__/trip-template.test.ts`:

```ts
import { createTripFromTemplate } from '../trip-template'

describe('createTripFromTemplate', () => {
  it('creates a fresh document with the requested id and title', () => {
    const trip = createTripFromTemplate({ id: 'trip_abc', title: 'Tahoe Weekend' })

    expect(trip.id).toBe('trip_abc')
    expect(trip.title).toBe('Tahoe Weekend')
    expect(trip.families.length).toBeGreaterThan(0)
    expect(trip.activities.length).toBeGreaterThan(0)
    expect(trip.ui.searchQuery).toBe('')
  })
})
```

- [ ] **Step 2: Rename model files**

Run:

```bash
git mv src/tripData.js src/tripData.ts
git mv src/tripModel.js src/tripModel.ts
```

Expected: `git status --short` shows both renames.

- [ ] **Step 3: Add type imports to `src/tripModel.ts`**

At the top of `src/tripModel.ts`, add:

```ts
import type { TripDocument } from './shared/trip-types'
```

Change the function signature:

```ts
export function createInitialTripDocument(): TripDocument {
```

If TypeScript reports fields in the seeded data that are not in `TripDocument`, add those fields to `src/shared/trip-types.ts` instead of casting the whole document to `any`.

- [ ] **Step 4: Create template wrapper**

Create `src/shared/trip-template.ts`:

```ts
import { createInitialTripDocument } from '../tripModel'
import type { TripDocument } from './trip-types'

export type CreateTripFromTemplateInput = {
  id: string
  title: string
}

export function createTripFromTemplate(input: CreateTripFromTemplateInput): TripDocument {
  const document = createInitialTripDocument()
  return {
    ...document,
    id: input.id,
    title: input.title,
    ui: {
      ...document.ui,
      searchQuery: '',
    },
  }
}
```

- [ ] **Step 5: Run template test**

Run:

```bash
npm run test -- src/shared/__tests__/trip-template.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run app typecheck and fix concrete type errors**

Run:

```bash
npm run typecheck
```

Expected: FAIL until the shared type surface matches seeded data. Fix only by adding typed optional fields to `src/shared/trip-types.ts` or by narrowing imported constants in `src/tripData.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/tripData.ts src/tripModel.ts src/shared/trip-template.ts src/shared/trip-types.ts src/shared/__tests__/trip-template.test.ts
git commit -m "feat: type trip template"
```

## Task 5: Add D1 Schema And Wrangler Configuration

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `wrangler.toml`
- Modify: `.env.example`
- Create: `worker/__tests__/schema.test.ts`

- [ ] **Step 1: Write schema test**

Create `worker/__tests__/schema.test.ts`:

```ts
import { readFileSync } from 'node:fs'

describe('D1 schema', () => {
  it('defines all required tables', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    for (const table of ['users', 'sessions', 'trips', 'memberships', 'invites', 'share_links', 'trip_snapshots', 'trip_events']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it('defines unique trip event versions', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    expect(sql).toContain('UNIQUE (trip_id, version)')
  })
})
```

- [ ] **Step 2: Run failing schema test**

Run:

```bash
npm run test:worker -- worker/__tests__/schema.test.ts
```

Expected: FAIL because `migrations/0001_init.sql` does not exist.

- [ ] **Step 3: Create D1 migration**

Create `migrations/0001_init.sql`:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_version INTEGER NOT NULL DEFAULT 0,
  latest_snapshot_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('editor')),
  email TEXT,
  expires_at TEXT NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  policy TEXT NOT NULL DEFAULT 'sanitized',
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_snapshots (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (trip_id, version)
);

CREATE TABLE IF NOT EXISTS trip_events (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  previous_version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (trip_id, version)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS trips_owner_user_id_idx ON trips(owner_user_id);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS invites_trip_id_idx ON invites(trip_id);
CREATE INDEX IF NOT EXISTS share_links_trip_id_idx ON share_links(trip_id);
CREATE INDEX IF NOT EXISTS trip_snapshots_trip_version_idx ON trip_snapshots(trip_id, version);
CREATE INDEX IF NOT EXISTS trip_events_trip_version_idx ON trip_events(trip_id, version);
```

- [ ] **Step 4: Create Wrangler config**

Create `wrangler.toml`:

```toml
name = "family-trip-command-center-api"
main = "worker/index.ts"
compatibility_date = "2026-07-01"

[[d1_databases]]
binding = "DB"
database_name = "family-trip-command-center"
database_id = "local-family-trip-command-center"
migrations_dir = "migrations"

[[durable_objects.bindings]]
name = "TRIP_ROOM"
class_name = "TripRoom"

[[migrations]]
tag = "v1"
new_classes = ["TripRoom"]

[vars]
APP_ORIGIN = "http://127.0.0.1:5173"
GOOGLE_REDIRECT_URI = "http://127.0.0.1:8787/api/auth/google/callback"
SESSION_COOKIE_NAME = "trip_session"
```

- [ ] **Step 5: Update `.env.example`**

Append:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_WS_BASE_URL=ws://127.0.0.1:8787

# Worker secrets set with wrangler secret put:
# GOOGLE_CLIENT_ID
# GOOGLE_CLIENT_SECRET
# SESSION_SECRET
```

- [ ] **Step 6: Run schema test**

Run:

```bash
npm run test:worker -- worker/__tests__/schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add migrations/0001_init.sql wrangler.toml .env.example worker/__tests__/schema.test.ts
git commit -m "feat: add d1 schema"
```

## Task 6: Worker HTTP, Env, And Auth Primitives

**Files:**
- Create: `worker/env.ts`
- Create: `worker/http.ts`
- Create: `worker/auth.ts`
- Create: `worker/__tests__/auth.test.ts`
- Create: `worker/__tests__/http.test.ts`

- [ ] **Step 1: Write auth tests**

Create `worker/__tests__/auth.test.ts`:

```ts
import { buildGoogleAuthUrl, hashToken, sessionCookie } from '../auth'

describe('auth helpers', () => {
  it('builds a Google auth URL with state', () => {
    const url = new URL(buildGoogleAuthUrl({
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/api/auth/google/callback',
      state: 'state_123',
    }))

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('scope')).toContain('openid')
    expect(url.searchParams.get('state')).toBe('state_123')
  })

  it('hashes tokens deterministically', async () => {
    await expect(hashToken('secret-token', 'session-secret')).resolves.toBe(await hashToken('secret-token', 'session-secret'))
  })

  it('creates a secure session cookie', () => {
    const cookie = sessionCookie('trip_session', 'raw-token', new Date('2026-07-02T00:00:00.000Z'))
    expect(cookie).toContain('trip_session=raw-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })
})
```

- [ ] **Step 2: Write HTTP tests**

Create `worker/__tests__/http.test.ts`:

```ts
import { jsonError, jsonOk, parseCookie } from '../http'

describe('http helpers', () => {
  it('serializes success JSON', async () => {
    const response = jsonOk({ id: 'trip_1' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, data: { id: 'trip_1' } })
  })

  it('serializes error JSON', async () => {
    const response = jsonError(403, 'forbidden', 'Trip access denied')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'Trip access denied' },
    })
  })

  it('parses cookies', () => {
    expect(parseCookie('a=1; trip_session=abc; b=2', 'trip_session')).toBe('abc')
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm run test:worker -- worker/__tests__/auth.test.ts worker/__tests__/http.test.ts
```

Expected: FAIL because Worker helper files do not exist.

- [ ] **Step 4: Implement Worker env types**

Create `worker/env.ts`:

```ts
export type Env = {
  DB: D1Database
  TRIP_ROOM: DurableObjectNamespace
  APP_ORIGIN: string
  GOOGLE_REDIRECT_URI: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  SESSION_COOKIE_NAME: string
}

export type AuthenticatedUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}
```

- [ ] **Step 5: Implement HTTP helpers**

Create `worker/http.ts`:

```ts
import type { ApiErrorCode } from '../src/shared/result'
import { err, ok } from '../src/shared/result'
import type { JsonValue } from '../src/shared/json'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

export function jsonOk<T extends JsonValue>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(ok(data)), {
    status: init?.status ?? 200,
    headers: { ...JSON_HEADERS, ...init?.headers },
  })
}

export function jsonError(status: number, code: ApiErrorCode, message: string): Response {
  return new Response(JSON.stringify(err(code, message)), {
    status,
    headers: JSON_HEADERS,
  })
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(';').map((part) => part.trim())
  const match = parts.find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export function redirect(location: string, headers?: HeadersInit): Response {
  return new Response(null, { status: 302, headers: { location, ...headers } })
}
```

- [ ] **Step 6: Implement auth helpers**

Create `worker/auth.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { AuthenticatedUser, Env } from './env'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export type BuildGoogleAuthUrlInput = {
  clientId: string
  redirectUri: string
  state: string
}

export function buildGoogleAuthUrl(input: BuildGoogleAuthUrlInput): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export async function hashToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sessionCookie(name: string, token: string, expiresAt: Date): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; Secure; SameSite=Lax`
}

export function clearSessionCookie(name: string): string {
  return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
}

export async function exchangeGoogleCode(env: Env, code: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`)
  const data = await response.json<{ id_token?: string }>()
  if (!data.id_token) throw new Error('Google token exchange response did not include id_token')
  return data.id_token
}

export async function verifyGoogleIdToken(env: Env, idToken: string): Promise<Omit<AuthenticatedUser, 'id'>> {
  const result = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: 'https://accounts.google.com',
    audience: env.GOOGLE_CLIENT_ID,
  })

  const email = result.payload.email
  const name = result.payload.name
  if (typeof result.payload.sub !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
    throw new Error('Google id token is missing required profile claims')
  }

  return {
    id: result.payload.sub,
    email,
    name,
    avatarUrl: typeof result.payload.picture === 'string' ? result.payload.picture : null,
  }
}
```

- [ ] **Step 7: Run auth and HTTP tests**

Run:

```bash
npm run test:worker -- worker/__tests__/auth.test.ts worker/__tests__/http.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/env.ts worker/http.ts worker/auth.ts worker/__tests__/auth.test.ts worker/__tests__/http.test.ts
git commit -m "feat: add worker auth primitives"
```

## Task 7: D1 Repositories And Trip Replay

**Files:**
- Create: `worker/db.ts`
- Create: `worker/__tests__/db.test.ts`

- [ ] **Step 1: Write repository shape tests**

Create `worker/__tests__/db.test.ts`:

```ts
import { decodeTripEventRow, encodeTripEventPayload } from '../db'

describe('db event codecs', () => {
  it('encodes and decodes trip event payloads', () => {
    const payload = { entityType: 'task', id: 'task_1' }
    const encoded = encodeTripEventPayload(payload)
    expect(encoded).toBe('{"entityType":"task","id":"task_1"}')

    const decoded = decodeTripEventRow({
      id: 'event_1',
      trip_id: 'trip_1',
      version: 1,
      previous_version: 0,
      actor_user_id: 'user_1',
      type: 'entity.delete',
      payload_json: encoded,
      created_at: '2026-07-01T00:00:00.000Z',
    })

    expect(decoded.payload).toEqual(payload)
    expect(decoded.type).toBe('entity.delete')
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run test:worker -- worker/__tests__/db.test.ts
```

Expected: FAIL because `worker/db.ts` does not exist.

- [ ] **Step 3: Implement DB helpers**

Create `worker/db.ts`:

```ts
import type { JsonValue } from '../src/shared/json'
import type { TripDocument, TripEvent } from '../src/shared/trip-types'

export type TripEventRow = {
  id: string
  trip_id: string
  version: number
  previous_version: number
  actor_user_id: string
  type: TripEvent['type']
  payload_json: string
  created_at: string
}

export function encodeTripEventPayload(payload: JsonValue | object): string {
  return JSON.stringify(payload)
}

export function decodeTripEventRow(row: TripEventRow): TripEvent {
  return {
    id: row.id,
    tripId: row.trip_id,
    version: row.version,
    previousVersion: row.previous_version,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    type: row.type,
    payload: JSON.parse(row.payload_json),
  } as TripEvent
}

export async function findSessionUser(db: D1Database, tokenHash: string, nowIso: string) {
  return db.prepare(`
    SELECT users.id, users.email, users.name, users.avatar_url
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, nowIso).first<{ id: string; email: string; name: string; avatar_url: string | null }>()
}

export async function findMembership(db: D1Database, tripId: string, userId: string) {
  return db.prepare(`
    SELECT role FROM memberships WHERE trip_id = ? AND user_id = ?
  `).bind(tripId, userId).first<{ role: 'owner' | 'editor' }>()
}

export async function insertSnapshot(db: D1Database, input: {
  id: string
  tripId: string
  version: number
  document: TripDocument
  userId: string | null
  createdAt: string
}) {
  await db.prepare(`
    INSERT INTO trip_snapshots (id, trip_id, version, document_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(input.id, input.tripId, input.version, JSON.stringify(input.document), input.userId, input.createdAt).run()
}

export async function insertTripEvent(db: D1Database, event: TripEvent) {
  await db.prepare(`
    INSERT INTO trip_events (id, trip_id, version, previous_version, actor_user_id, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.id,
    event.tripId,
    event.version,
    event.previousVersion,
    event.actorUserId,
    event.type,
    JSON.stringify(event.payload),
    event.createdAt,
  ).run()
}
```

- [ ] **Step 4: Run DB tests**

Run:

```bash
npm run test:worker -- worker/__tests__/db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.ts worker/__tests__/db.test.ts
git commit -m "feat: add d1 repositories"
```

## Task 8: Worker API Entry And Core Routes

**Files:**
- Create: `worker/index.ts`
- Create: `worker/__tests__/api.test.ts`

- [ ] **Step 1: Write API smoke tests**

Create `worker/__tests__/api.test.ts`:

```ts
import worker from '../index'

describe('worker api', () => {
  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/nope'), {} as never, {} as never)
    expect(response.status).toBe(404)
  })

  it('redirects Google auth start', async () => {
    const env = {
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
      APP_ORIGIN: 'http://localhost:5173',
      SESSION_COOKIE_NAME: 'trip_session',
    }
    const response = await worker.fetch(new Request('http://localhost/api/auth/google/start'), env as never, {} as never)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('https://accounts.google.com')
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run test:worker -- worker/__tests__/api.test.ts
```

Expected: FAIL because `worker/index.ts` does not exist.

- [ ] **Step 3: Implement Worker route skeleton**

Create `worker/index.ts`:

```ts
import { buildGoogleAuthUrl, clearSessionCookie } from './auth'
import type { Env } from './env'
import { jsonError, jsonOk, redirect } from './http'
export { TripRoom } from './trip-room'

function routePath(request: Request): string {
  return new URL(request.url).pathname
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = routePath(request)

    if (request.method === 'GET' && path === '/api/auth/google/start') {
      const state = crypto.randomUUID()
      return redirect(buildGoogleAuthUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: env.GOOGLE_REDIRECT_URI,
        state,
      }))
    }

    if (request.method === 'POST' && path === '/api/auth/logout') {
      return jsonOk({ loggedOut: true }, {
        headers: { 'set-cookie': clearSessionCookie(env.SESSION_COOKIE_NAME) },
      })
    }

    if (request.method === 'GET' && path === '/api/me') {
      return jsonError(401, 'unauthorized', 'Sign in required')
    }

    return jsonError(404, 'not_found', 'Route not found')
  },
}
```

- [ ] **Step 4: Add minimal TripRoom export file**

Create `worker/trip-room.ts`:

```ts
export class TripRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: unknown) {}

  async fetch(): Promise<Response> {
    return new Response('Expected WebSocket', { status: 426 })
  }
}
```

- [ ] **Step 5: Run API tests**

Run:

```bash
npm run test:worker -- worker/__tests__/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/index.ts worker/trip-room.ts worker/__tests__/api.test.ts
git commit -m "feat: add worker api skeleton"
```

## Task 9: Auth Callback, Sessions, Trips, Invites, And Shares

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/db.ts`
- Create: `worker/__tests__/access.test.ts`

- [ ] **Step 1: Write access tests**

Create `worker/__tests__/access.test.ts`:

```ts
import { canManageAccess, canWriteTrip } from '../index'

describe('access policy', () => {
  it('allows owners to manage access and write', () => {
    expect(canManageAccess('owner')).toBe(true)
    expect(canWriteTrip('owner')).toBe(true)
  })

  it('allows editors to write but not manage access', () => {
    expect(canManageAccess('editor')).toBe(false)
    expect(canWriteTrip('editor')).toBe(true)
  })

  it('rejects missing membership', () => {
    expect(canManageAccess(null)).toBe(false)
    expect(canWriteTrip(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run failing access test**

Run:

```bash
npm run test:worker -- worker/__tests__/access.test.ts
```

Expected: FAIL because `canManageAccess` and `canWriteTrip` are not exported.

- [ ] **Step 3: Add access helpers to `worker/index.ts`**

Add:

```ts
export type TripRole = 'owner' | 'editor'

export function canWriteTrip(role: TripRole | null): boolean {
  return role === 'owner' || role === 'editor'
}

export function canManageAccess(role: TripRole | null): boolean {
  return role === 'owner'
}
```

- [ ] **Step 4: Add repository functions to `worker/db.ts`**

Add:

```ts
export async function upsertGoogleUser(db: D1Database, input: {
  id: string
  googleSub: string
  email: string
  name: string
  avatarUrl: string | null
  now: string
}) {
  await db.prepare(`
    INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).bind(input.id, input.googleSub, input.email, input.name, input.avatarUrl, input.now, input.now).run()

  return db.prepare(`SELECT id, email, name, avatar_url FROM users WHERE google_sub = ?`)
    .bind(input.googleSub)
    .first<{ id: string; email: string; name: string; avatar_url: string | null }>()
}

export async function createSession(db: D1Database, input: {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
}) {
  await db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(input.id, input.userId, input.tokenHash, input.expiresAt, input.createdAt).run()
}
```

- [ ] **Step 5: Wire routes in `worker/index.ts`**

Implement these route branches in `fetch`:

```ts
// GET /api/auth/google/callback
// 1. read code from URL
// 2. exchangeGoogleCode(env, code)
// 3. verifyGoogleIdToken(env, idToken)
// 4. upsertGoogleUser
// 5. createSession
// 6. redirect to `${env.APP_ORIGIN}/trips` with set-cookie

// GET /api/trips
// return 401 until currentUserFromRequest is implemented in this task

// POST /api/trips
// create trip, owner membership, version 0 snapshot from createTripFromTemplate

// POST /api/trips/:tripId/invites
// owner only, create token with createToken(), store hash, return raw URL

// POST /api/invites/:token/accept
// signed-in user only, hash token, find invite, create editor membership

// POST /api/trips/:tripId/share-link
// owner only, create or rotate sanitized share token

// DELETE /api/trips/:tripId/share-link
// owner only, disable active share link

// GET /api/share/:token
// hash token, load trip snapshot and events, sanitizeTripForShare, return read-only document
```

Use exact status behavior from the spec: `401`, `403`, `404`, `409`, `400`, `500`.

- [ ] **Step 6: Run worker tests**

Run:

```bash
npm run test:worker
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/index.ts worker/db.ts worker/__tests__/access.test.ts
git commit -m "feat: add trip access api"
```

## Task 10: Durable Object Trip Room

**Files:**
- Modify: `worker/trip-room.ts`
- Create: `worker/__tests__/trip-room.test.ts`

- [ ] **Step 1: Write room helper tests**

Create `worker/__tests__/trip-room.test.ts`:

```ts
import { acceptCommand } from '../trip-room'
import type { TripDocument } from '../../src/shared/trip-types'

function doc(): TripDocument {
  return {
    id: 'trip_1',
    title: 'Room Trip',
    selectedPage: 'itinerary',
    selection: { type: 'task', id: 'task_1' },
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      searchQuery: '',
      timeline: { mode: 'scenario', cursorSlot: 0 },
      map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
    },
    families: [],
    locations: [],
    routes: [],
    itineraryItems: [],
    meals: [],
    activities: [],
    stayItems: [],
    expenses: [],
    tasks: [],
  }
}

describe('acceptCommand', () => {
  it('rejects stale base versions', () => {
    const result = acceptCommand({
      document: doc(),
      currentVersion: 2,
      command: {
        id: 'cmd_1',
        baseVersion: 1,
        type: 'pageNote.update',
        payload: { pageId: 'itinerary', value: 'Bring snacks' },
      },
      actorUserId: 'user_1',
      tripId: 'trip_1',
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('stale_version')
  })

  it('creates the next event and document for current commands', () => {
    const result = acceptCommand({
      document: doc(),
      currentVersion: 2,
      command: {
        id: 'cmd_2',
        baseVersion: 2,
        type: 'pageNote.update',
        payload: { pageId: 'itinerary', value: 'Bring snacks' },
      },
      actorUserId: 'user_1',
      tripId: 'trip_1',
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.event.version).toBe(3)
      expect(result.document.pageNotes.itinerary).toBe('Bring snacks')
    }
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run test:worker -- worker/__tests__/trip-room.test.ts
```

Expected: FAIL because `acceptCommand` is not exported.

- [ ] **Step 3: Implement command acceptance**

Replace `worker/trip-room.ts` with:

```ts
import { createId } from '../src/shared/ids'
import { applyTripEvent } from '../src/shared/trip-reducer'
import type { TripDocument, TripEvent } from '../src/shared/trip-types'
import type { Env } from './env'

export type TripCommand = Omit<TripEvent, 'id' | 'tripId' | 'version' | 'previousVersion' | 'actorUserId' | 'createdAt'> & {
  id: string
  baseVersion: number
}

export type AcceptCommandInput = {
  document: TripDocument
  currentVersion: number
  command: TripCommand
  actorUserId: string
  tripId: string
  now: string
}

export type AcceptCommandResult =
  | { ok: true; event: TripEvent; document: TripDocument }
  | { ok: false; reason: 'stale_version' }

export function acceptCommand(input: AcceptCommandInput): AcceptCommandResult {
  if (input.command.baseVersion !== input.currentVersion) {
    return { ok: false, reason: 'stale_version' }
  }

  const event = {
    id: createId('event'),
    tripId: input.tripId,
    version: input.currentVersion + 1,
    previousVersion: input.currentVersion,
    actorUserId: input.actorUserId,
    createdAt: input.now,
    type: input.command.type,
    payload: input.command.payload,
  } as TripEvent

  return {
    ok: true,
    event,
    document: applyTripEvent(input.document, event),
  }
}

export class TripRoom implements DurableObject {
  private document: TripDocument | null = null
  private version = 0
  private sockets = new Set<WebSocket>()

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    this.sockets.add(server)
    server.addEventListener('close', () => this.sockets.delete(server))
    server.addEventListener('message', (event) => {
      this.broadcast(typeof event.data === 'string' ? event.data : JSON.stringify({ type: 'binary_ignored' }))
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  private broadcast(message: string): void {
    this.sockets.forEach((socket) => {
      try {
        socket.send(message)
      } catch {
        this.sockets.delete(socket)
      }
    })
  }
}
```

- [ ] **Step 4: Run room tests**

Run:

```bash
npm run test:worker -- worker/__tests__/trip-room.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend room with D1 hydration and event persistence**

Add these behaviors to `TripRoom.fetch` and private methods:

```ts
// read tripId from URL path `/api/trips/:tripId/live`
// validate session cookie using hashToken and findSessionUser
// validate membership using findMembership
// hydrate `this.document` from latest snapshot plus subsequent trip_events
// on JSON command message: acceptCommand, insertTripEvent, update trips.current_version
// every 25 accepted events: insertSnapshot and update trips.latest_snapshot_id
// broadcast { type: 'event.accepted', event, version }
// on stale command: send { type: 'event.rejected', reason: 'stale_version', version, document }
```

Keep this code inside `worker/trip-room.ts`; pull only pure helpers into exported functions when tests need them.

- [ ] **Step 6: Run Worker typecheck**

Run:

```bash
npm run typecheck:worker
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/trip-room.ts worker/__tests__/trip-room.test.ts
git commit -m "feat: add trip durable object room"
```

## Task 11: Frontend Router, API Client, And Trip Room Hook

**Files:**
- Create: `src/app/router.tsx`
- Create: `src/app/api-client.ts`
- Create: `src/app/useTripRoom.ts`
- Create: `src/app/__tests__/router.test.ts`

- [ ] **Step 1: Write router test**

Create `src/app/__tests__/router.test.ts`:

```ts
import { matchRoute } from '../router'

describe('matchRoute', () => {
  it('matches trip routes', () => {
    expect(matchRoute('/trips/trip_123')).toEqual({ name: 'trip', tripId: 'trip_123' })
  })

  it('matches share routes', () => {
    expect(matchRoute('/share/token_123')).toEqual({ name: 'share', token: 'token_123' })
  })
})
```

- [ ] **Step 2: Run failing router test**

Run:

```bash
npm run test -- src/app/__tests__/router.test.ts
```

Expected: FAIL because `src/app/router.tsx` does not exist.

- [ ] **Step 3: Implement tiny router**

Create `src/app/router.tsx`:

```tsx
import { useEffect, useState } from 'react'

export type RouteMatch =
  | { name: 'login' }
  | { name: 'trips' }
  | { name: 'trip'; tripId: string }
  | { name: 'share'; token: string }

export function matchRoute(pathname: string): RouteMatch {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'login') return { name: 'login' }
  if (parts[0] === 'share' && parts[1]) return { name: 'share', token: parts[1] }
  if (parts[0] === 'trips' && parts[1]) return { name: 'trip', tripId: parts[1] }
  return { name: 'trips' }
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): RouteMatch {
  const [route, setRoute] = useState(() => matchRoute(window.location.pathname))

  useEffect(() => {
    const update = () => setRoute(matchRoute(window.location.pathname))
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  return route
}
```

- [ ] **Step 4: Implement API client**

Create `src/app/api-client.ts`:

```ts
import type { ApiResult } from '../shared/result'
import type { JsonValue } from '../shared/json'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export async function apiGet<T extends JsonValue>(path: string): Promise<ApiResult<T>> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  return response.json()
}

export async function apiPost<T extends JsonValue>(path: string, body?: JsonValue): Promise<ApiResult<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return response.json()
}
```

- [ ] **Step 5: Implement trip room hook**

Create `src/app/useTripRoom.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TripDocument, TripEvent } from '../shared/trip-types'
import { applyTripEvent } from '../shared/trip-reducer'

type RoomMessage =
  | { type: 'snapshot'; document: TripDocument; version: number }
  | { type: 'event.accepted'; event: TripEvent; version: number }
  | { type: 'event.rejected'; reason: 'stale_version'; document: TripDocument; version: number }

export type TripRoomState = {
  document: TripDocument | null
  version: number
  status: 'connecting' | 'open' | 'closed' | 'error'
  sendCommand: (command: object) => void
}

export function useTripRoom(tripId: string): TripRoomState {
  const [document, setDocument] = useState<TripDocument | null>(null)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState<TripRoomState['status']>('connecting')
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const base = import.meta.env.VITE_WS_BASE_URL || window.location.origin.replace(/^http/, 'ws')
    const socket = new WebSocket(`${base}/api/trips/${tripId}/live`)
    socketRef.current = socket
    socket.addEventListener('open', () => setStatus('open'))
    socket.addEventListener('close', () => setStatus('closed'))
    socket.addEventListener('error', () => setStatus('error'))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as RoomMessage
      if (message.type === 'snapshot') {
        setDocument(message.document)
        setVersion(message.version)
      }
      if (message.type === 'event.accepted') {
        setDocument((current) => (current ? applyTripEvent(current, message.event) : current))
        setVersion(message.version)
      }
      if (message.type === 'event.rejected') {
        setDocument(message.document)
        setVersion(message.version)
      }
    })
    return () => socket.close()
  }, [tripId])

  const sendCommand = useCallback((command: object) => {
    socketRef.current?.send(JSON.stringify(command))
  }, [])

  return useMemo(() => ({ document, version, status, sendCommand }), [document, sendCommand, status, version])
}
```

- [ ] **Step 6: Run router test**

Run:

```bash
npm run test -- src/app/__tests__/router.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/router.tsx src/app/api-client.ts src/app/useTripRoom.ts src/app/__tests__/router.test.ts
git commit -m "feat: add frontend service client"
```

## Task 12: Convert Existing UI Files To TypeScript

**Files:**
- Rename: `src/main.jsx` to `src/main.tsx`
- Rename: `src/App.jsx` to `src/App.tsx`
- Rename: `src/CommandMap.jsx` to `src/CommandMap.tsx`
- Rename: `src/InspectorRail.jsx` to `src/InspectorRail.tsx`
- Rename: `src/weather.js` to `src/weather.ts`
- Rename: `src/publishConfig.js` to `src/publishConfig.ts`
- Rename: `src/usePersistedTripState.js` to `src/usePersistedTripState.ts`
- Modify: imports affected by the renames

- [ ] **Step 1: Rename UI files**

Run:

```bash
git mv src/main.jsx src/main.tsx
git mv src/App.jsx src/App.tsx
git mv src/CommandMap.jsx src/CommandMap.tsx
git mv src/InspectorRail.jsx src/InspectorRail.tsx
git mv src/weather.js src/weather.ts
git mv src/publishConfig.js src/publishConfig.ts
git mv src/usePersistedTripState.js src/usePersistedTripState.ts
```

Expected: `git status --short` shows seven renames.

- [ ] **Step 2: Update `index.html` entrypoint**

Change:

```html
<script type="module" src="/src/main.jsx"></script>
```

to:

```html
<script type="module" src="/src/main.tsx"></script>
```

- [ ] **Step 3: Add minimal React prop types where TypeScript blocks build**

For small leaf components, add explicit props next to the function. Example:

```ts
type StatusPillProps = {
  children: React.ReactNode
  tone?: string
  className?: string
}

function StatusPill({ children, tone = 'Transit', className }: StatusPillProps) {
```

Use `TripDocument`, `TripEntity`, `EntitySelection`, and entity types from `src/shared/trip-types.ts` for dashboard data props.

- [ ] **Step 4: Run app typecheck**

Run:

```bash
npm run typecheck
```

Expected: FAIL until all `.tsx` implicit `any` props and event parameters are typed. Keep fixes local to renamed files and shared types.

- [ ] **Step 5: Run app typecheck again**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.tsx src/App.tsx src/CommandMap.tsx src/InspectorRail.tsx src/weather.ts src/publishConfig.ts src/usePersistedTripState.ts src/shared/trip-types.ts
git commit -m "refactor: convert dashboard to typescript"
```

## Task 13: Login, Trips, Share, And Workspace Shell

**Files:**
- Modify: `src/main.tsx`
- Create: `src/app/LoginPage.tsx`
- Create: `src/app/TripsPage.tsx`
- Create: `src/app/SharePage.tsx`
- Create: `src/app/TripWorkspace.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement login page**

Create `src/app/LoginPage.tsx`:

```tsx
export function LoginPage() {
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''

  return (
    <main className="flex h-screen items-center justify-center bg-[#0d1117] text-[#C9D1D9]">
      <section className="w-[360px] border border-[#30363D] bg-[#161B22] p-6">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">Family Ops</div>
        <h1 className="text-[18px] font-black uppercase tracking-[0.08em]">Sign in</h1>
        <a
          className="mt-6 block border border-[#30363D] bg-[#0d1117] px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.14em] text-[#C9D1D9] hover:border-[#58A6FF]"
          href={`${apiBase}/api/auth/google/start`}
        >
          Continue with Google
        </a>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Implement trips page**

Create `src/app/TripsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from './api-client'
import { navigate } from './router'

type TripSummary = { id: string; title: string; role: 'owner' | 'editor'; updatedAt: string }

export function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ trips: TripSummary[] }>('/api/trips').then((result) => {
      if (result.ok) setTrips(result.data.trips)
      else setError(result.error.message)
    })
  }, [])

  async function createTrip() {
    const result = await apiPost<{ id: string }>('/api/trips', { title: 'New Family Trip' })
    if (result.ok) navigate(`/trips/${result.data.id}`)
    else setError(result.error.message)
  }

  return (
    <main className="min-h-screen bg-[#0d1117] p-6 text-[#C9D1D9]">
      <header className="mb-5 flex items-center justify-between border-b border-[#30363D] pb-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#3FB950]">UNCLASSIFIED // FAMILY OPS</div>
          <h1 className="mt-2 text-[18px] font-black uppercase tracking-[0.08em]">Trips</h1>
        </div>
        <button className="border border-[#58A6FF]/50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#58A6FF]" onClick={createTrip}>
          Create from template
        </button>
      </header>
      {error ? <div className="mb-4 border border-[#F85149] p-3 text-[11px] text-[#F85149]">{error}</div> : null}
      <div className="grid gap-2">
        {trips.map((trip) => (
          <button key={trip.id} className="border border-[#30363D] bg-[#161B22] p-4 text-left hover:border-[#58A6FF]/50" onClick={() => navigate(`/trips/${trip.id}`)}>
            <div className="text-[12px] font-black uppercase tracking-[0.12em]">{trip.title}</div>
            <div className="mt-1 font-mono text-[10px] text-[#8B949E]">{trip.role} / {trip.updatedAt}</div>
          </button>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Implement share page**

Create `src/app/SharePage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { TripDocument } from '../shared/trip-types'
import { apiGet } from './api-client'
import { TripWorkspace } from './TripWorkspace'

export function SharePage({ token }: { token: string }) {
  const [document, setDocument] = useState<TripDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ document: TripDocument }>(`/api/share/${token}`).then((result) => {
      if (result.ok) setDocument(result.data.document)
      else setError(result.error.message)
    })
  }, [token])

  if (error) return <main className="min-h-screen bg-[#0d1117] p-6 text-[#F85149]">{error}</main>
  if (!document) return <main className="min-h-screen bg-[#0d1117] p-6 text-[#8B949E]">Loading shared trip...</main>
  return <TripWorkspace initialDocument={document} readOnly />
}
```

- [ ] **Step 4: Implement workspace wrapper**

Create `src/app/TripWorkspace.tsx`:

```tsx
import App from '../App'
import type { TripDocument } from '../shared/trip-types'

export function TripWorkspace({ tripId, initialDocument, readOnly = false }: { tripId?: string; initialDocument?: TripDocument; readOnly?: boolean }) {
  return <App serviceTripId={tripId} initialServiceDocument={initialDocument} readOnly={readOnly} />
}
```

- [ ] **Step 5: Update `src/main.tsx`**

Replace the root render with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { LoginPage } from './app/LoginPage'
import { SharePage } from './app/SharePage'
import { TripsPage } from './app/TripsPage'
import { TripWorkspace } from './app/TripWorkspace'
import { useRoute } from './app/router'

function Root() {
  const route = useRoute()
  if (route.name === 'login') return <LoginPage />
  if (route.name === 'share') return <SharePage token={route.token} />
  if (route.name === 'trip') return <TripWorkspace tripId={route.tripId} />
  return <TripsPage />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
```

- [ ] **Step 6: Update `App` props**

Change `function App()` in `src/App.tsx` to accept service props:

```ts
type AppProps = {
  serviceTripId?: string
  initialServiceDocument?: TripDocument
  readOnly?: boolean
}

function App({ serviceTripId, initialServiceDocument, readOnly = false }: AppProps) {
```

Use `initialServiceDocument` as the initial document when present. Disable mutating handlers when `readOnly` is true by returning early from handlers such as `updatePageNote`, `toggleTask`, `addTask`, `addActivity`, `toggleMealStatus`, `toggleExpenseSettled`, `updateExpenseFields`, and `addExpense`.

- [ ] **Step 7: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main.tsx src/app/LoginPage.tsx src/app/TripsPage.tsx src/app/SharePage.tsx src/app/TripWorkspace.tsx src/App.tsx
git commit -m "feat: add service routes"
```

## Task 14: Wire Dashboard Mutations To Trip Events

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/app/useTripRoom.ts`

- [ ] **Step 1: Add command helper in `src/App.tsx`**

Add:

```ts
function buildCommand(type: TripEvent['type'], baseVersion: number, payload: TripEvent['payload']) {
  return {
    id: createId('cmd'),
    baseVersion,
    type,
    payload,
  }
}
```

Import:

```ts
import { createId } from './shared/ids'
import type { TripEvent } from './shared/trip-types'
import { useTripRoom } from './app/useTripRoom'
```

- [ ] **Step 2: Use `useTripRoom` when `serviceTripId` exists**

Inside `App`:

```ts
const room = serviceTripId ? useTripRoom(serviceTripId) : null
const activeDoc = room?.document || initialServiceDocument || doc
const activeVersion = room?.version || 0
const setTripDocument = (updater: (current: TripDocument) => TripDocument) => {
  if (!serviceTripId) {
    setDoc(updater)
    return
  }
  const current = room?.document
  if (!current || readOnly) return
  const next = updater(current)
  room?.sendCommand(buildCommand('trip.meta.update', activeVersion, { title: next.title }))
}
```

Then replace direct `doc` reads used for rendering with `activeDoc`. Keep local UI fallback only for the existing unauthenticated demo path.

- [ ] **Step 3: Convert mutating handlers to typed commands**

For each handler, send the smallest event:

```ts
room?.sendCommand(buildCommand('entity.update', activeVersion, {
  entityType: 'task',
  id: taskId,
  patch: { status: nextStatus },
}))
```

Use:

- `entity.create` for add task, add activity, add expense, and new CRUD panel creates.
- `entity.update` for notes, status changes, expense field edits, family edits, location edits, route edits, meal edits, activity edits, stay edits.
- `entity.delete` for deletes.
- `pageNote.update` for page notes.
- `uiState.update` for search, timeline, and map UI.
- `trip.meta.update` for title changes.

- [ ] **Step 4: Run reducer tests**

Run:

```bash
npm run test -- src/shared/__tests__/trip-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/app/useTripRoom.ts
git commit -m "feat: wire dashboard to trip events"
```

## Task 15: Add Full CRUD Panel For Core Entities

**Files:**
- Create: `src/components/EntityCrudPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/InspectorRail.tsx`

- [ ] **Step 1: Create CRUD panel**

Create `src/components/EntityCrudPanel.tsx`:

```tsx
import type { TripDocument, TripEntityType } from '../shared/trip-types'
import { COLLECTION_BY_ENTITY_TYPE } from '../shared/trip-types'

type EntityCrudPanelProps = {
  document: TripDocument
  entityType: TripEntityType
  readOnly: boolean
  onCreate: (entityType: TripEntityType) => void
  onDelete: (entityType: TripEntityType, id: string) => void
}

export function EntityCrudPanel({ document, entityType, readOnly, onCreate, onDelete }: EntityCrudPanelProps) {
  const collectionName = COLLECTION_BY_ENTITY_TYPE[entityType]
  const entities = document[collectionName]

  return (
    <section className="border border-[#30363D] bg-[#161B22] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">{entityType} records</div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onCreate(entityType)}
          className="border border-[#30363D] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="grid max-h-64 gap-1 overflow-auto">
        {entities.map((entity) => (
          <div key={entity.id} className="flex items-center justify-between gap-2 border border-[#30363D]/60 bg-[#0d1117] px-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-bold text-[#C9D1D9]">{entity.title || entity.name || entity.id}</div>
              <div className="font-mono text-[9px] text-[#8B949E]">{entity.id}</div>
            </div>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => onDelete(entityType, entity.id)}
              className="text-[9px] font-black uppercase tracking-wider text-[#F85149] disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add create defaults in `src/App.tsx`**

Add a `createDefaultEntity(entityType)` helper that returns a valid typed entity for each `TripEntityType`. Use current date-based IDs with `createId(entityType)`. Set `title`, `type`, `note`, and required fields for each entity.

Example branch:

```ts
if (entityType === 'task') {
  return {
    id: createId('task'),
    type: 'task',
    title: 'New task',
    dayId: 'all',
    status: 'open',
    linkedEntityKeys: [],
    note: '',
  }
}
```

- [ ] **Step 3: Wire create and delete commands**

In `App`, add:

```ts
const createEntity = (entityType: TripEntityType) => {
  if (readOnly) return
  const entity = createDefaultEntity(entityType)
  room?.sendCommand(buildCommand('entity.create', activeVersion, { entityType, entity }))
}

const deleteEntity = (entityType: TripEntityType, id: string) => {
  if (readOnly) return
  room?.sendCommand(buildCommand('entity.delete', activeVersion, { entityType, id }))
}
```

- [ ] **Step 4: Place CRUD panel in inspector**

In `src/InspectorRail.tsx`, render `EntityCrudPanel` near the selected entity details for service mode. Pass the selected entity type, `readOnly`, `onCreate`, and `onDelete`.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/EntityCrudPanel.tsx src/App.tsx src/InspectorRail.tsx
git commit -m "feat: add entity crud panel"
```

## Task 16: Trip Settings Panel For Invites And Shares

**Files:**
- Create: `src/app/TripSettingsPanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement settings panel**

Create `src/app/TripSettingsPanel.tsx`:

```tsx
import { useState } from 'react'
import { apiPost } from './api-client'

export function TripSettingsPanel({ tripId, readOnly }: { tripId: string; readOnly: boolean }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function createInvite() {
    const result = await apiPost<{ url: string }>(`/api/trips/${tripId}/invites`, { role: 'editor' })
    if (result.ok) setInviteUrl(result.data.url)
    else setError(result.error.message)
  }

  async function createShare() {
    const result = await apiPost<{ url: string }>(`/api/trips/${tripId}/share-link`, {})
    if (result.ok) setShareUrl(result.data.url)
    else setError(result.error.message)
  }

  return (
    <section className="border border-[#30363D] bg-[#161B22] p-4">
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Access</div>
      {error ? <div className="mb-3 text-[11px] text-[#F85149]">{error}</div> : null}
      <div className="grid gap-2">
        <button disabled={readOnly} onClick={createInvite} className="border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40">
          Create invite link
        </button>
        {inviteUrl ? <input readOnly value={inviteUrl} className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]" /> : null}
        <button disabled={readOnly} onClick={createShare} className="border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40">
          Create sanitized share
        </button>
        {shareUrl ? <input readOnly value={shareUrl} className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]" /> : null}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Render settings panel from dashboard**

In `src/App.tsx`, import:

```ts
import { TripSettingsPanel } from './app/TripSettingsPanel'
```

Render in the right-side inspector area when `serviceTripId` exists:

```tsx
{serviceTripId ? <TripSettingsPanel tripId={serviceTripId} readOnly={readOnly} /> : null}
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/TripSettingsPanel.tsx src/App.tsx
git commit -m "feat: add trip access settings"
```

## Task 17: Local Cloudflare Smoke And Deployment Docs

**Files:**
- Modify: `README.md`
- Create: `docs/deploy-cloudflare.md`

- [ ] **Step 1: Add deployment doc**

Create `docs/deploy-cloudflare.md`:

```md
# Cloudflare Deployment

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the Worker:

```bash
npm run dev:worker
```

Apply D1 migrations locally:

```bash
npx wrangler d1 migrations apply family-trip-command-center --local
```

## Required Secrets

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

## Checks

```bash
npm run cf:build
```

## Deploy

Deploy the Worker:

```bash
npm run cf:deploy
```

Deploy the Pages frontend from the Cloudflare dashboard or connected Git repository with:

- Build command: `npm run build`
- Output directory: `dist`
```

- [ ] **Step 2: Update README**

Add a `Cloudflare Service` section pointing to `docs/deploy-cloudflare.md` and listing:

```md
- Google login
- D1-backed trips
- Durable Object real-time editing
- Copyable invite links
- Sanitized public share links
```

- [ ] **Step 3: Run final checks**

Run:

```bash
npm run cf:build
```

Expected: PASS for app typecheck, Worker typecheck, app tests, Worker tests, and Vite build.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/deploy-cloudflare.md
git commit -m "docs: add cloudflare deployment guide"
```

## Task 18: Final Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Confirm clean tracked status**

Run:

```bash
git status --short
```

Expected: no tracked changes. The unrelated untracked `AGENTS.md` may still appear and should remain unmodified unless the user asks.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run cf:build
```

Expected: PASS.

- [ ] **Step 3: Run local D1 migration smoke**

Run:

```bash
npx wrangler d1 migrations apply family-trip-command-center --local
```

Expected: Wrangler reports the migration applied or already applied for local D1.

- [ ] **Step 4: Start local services for manual smoke**

Terminal 1:

```bash
npm run dev:worker
```

Terminal 2:

```bash
npm run dev
```

Expected:

- Worker listens on `http://127.0.0.1:8787`.
- Vite listens on `http://127.0.0.1:5173`.
- `/login` renders the Google sign-in screen.
- `/trips` redirects or errors cleanly when not signed in.
- `/share/not-real` shows a not-found style error.

- [ ] **Step 5: Final commit if verification changed docs or config**

If verification required any source change:

```bash
git add README.md docs/deploy-cloudflare.md package.json package-lock.json wrangler.toml
git commit -m "chore: finish cloudflare verification"
```

If verification changed nothing, do not create an empty commit.

## Self-Review Notes

Spec coverage:

- Strict TypeScript: Tasks 1, 4, 12, 18.
- Cloudflare Pages, Worker, D1, Durable Objects: Tasks 5, 8, 10, 17, 18.
- Google login: Tasks 6 and 9.
- Multiple trips and create from template: Tasks 4, 9, 13.
- Trip-scoped invited editing: Tasks 5, 6, 7, 9, 10.
- Full CRUD for core entities: Tasks 3, 14, 15.
- Copyable invite links: Tasks 9 and 16.
- Sanitized read-only share: Tasks 3, 9, 13, 16.
- Real-time collaboration: Tasks 10, 11, 14.
- Event-sourced patches and snapshots: Tasks 3, 5, 7, 10.
- Tests and deployment docs: Tasks 1 through 18.

No known spec gaps remain.
