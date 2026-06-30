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

export type Coordinates = JsonObject & {
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

export type EntityByType = {
  family: FamilyEntity
  location: LocationEntity
  route: RouteEntity
  itineraryItem: ItineraryItemEntity
  meal: MealEntity
  activity: ActivityEntity
  stayItem: StayItemEntity
  expense: ExpenseEntity
  task: TaskEntity
}

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

type TripEventBase = {
  id: string
  tripId: string
  version: number
  previousVersion: number
  actorUserId: string
  createdAt: string
}

type EntityCreateEvent = {
  [Type in TripEntityType]: TripEventBase & {
    type: 'entity.create'
    payload: { entityType: Type; entity: EntityByType[Type] }
  }
}[TripEntityType]

type EntityUpdatePatch<Type extends TripEntityType> = Partial<Omit<EntityByType[Type], 'id' | 'type'>> & {
  id?: never
  type?: never
}

type EntityUpdateEvent = {
  [Type in TripEntityType]: TripEventBase & {
    type: 'entity.update'
    payload: { entityType: Type; id: string; patch: EntityUpdatePatch<Type> }
  }
}[TripEntityType]

type EntityDeleteEvent = {
  [Type in TripEntityType]: TripEventBase & {
    type: 'entity.delete'
    payload: { entityType: Type; id: string }
  }
}[TripEntityType]

export type TripEvent =
  | EntityCreateEvent
  | EntityUpdateEvent
  | EntityDeleteEvent
  | (TripEventBase & {
      type: 'pageNote.update'
      payload: { pageId: string; value: string }
    })
  | (TripEventBase & {
      type: 'uiState.update'
      payload: Partial<TripUiState>
    })
  | (TripEventBase & {
      type: 'trip.meta.update'
      payload: { title?: string }
    })
