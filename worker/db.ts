import { isJsonObject, type JsonObject, type JsonValue } from '../src/shared/json'
import type { TripDocument, TripEntityType, TripEvent, TripUiState } from '../src/shared/trip-types'

const TRIP_ENTITY_TYPES = new Set<TripEntityType>([
  'family',
  'location',
  'route',
  'itineraryItem',
  'meal',
  'activity',
  'stayItem',
  'expense',
  'task',
])

export type TripEventRow = {
  id: string
  trip_id: string
  version: number
  previous_version: number
  actor_user_id: string | null
  type: string
  payload_json: string
  created_at: string
}

export type AuthoredTripEvent = TripEvent & { actorUserId: string }

export function encodeTripEventPayload(payload: JsonValue | object): string {
  const encoded = JSON.stringify(payload)
  if (typeof encoded !== 'string') {
    throw new Error('Trip event payload must be JSON serializable')
  }
  return encoded
}

export function decodeTripEventRow(row: TripEventRow): TripEvent {
  const payload = parsePayload(row)
  const base = {
    id: row.id,
    tripId: row.trip_id,
    version: row.version,
    previousVersion: row.previous_version,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
  }

  switch (row.type) {
    case 'entity.create':
      return buildEntityCreateEvent(base, decodeEntityCreatePayload(row.id, payload))
    case 'entity.update':
      return buildEntityUpdateEvent(base, decodeEntityUpdatePayload(row.id, payload))
    case 'entity.delete':
      return buildEntityDeleteEvent(base, decodeEntityDeletePayload(row.id, payload))
    case 'pageNote.update':
      return { ...base, type: row.type, payload: decodePageNoteUpdatePayload(row.id, payload) }
    case 'uiState.update':
      return { ...base, type: row.type, payload: decodeUiStateUpdatePayload(row.id, payload) }
    case 'trip.meta.update':
      return { ...base, type: row.type, payload: decodeTripMetaUpdatePayload(row.id, payload) }
    default:
      throw new Error(`Trip event ${row.id} has unsupported type ${row.type}`)
  }
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
  `).bind(
    input.id,
    input.tripId,
    input.version,
    JSON.stringify(input.document),
    input.userId,
    input.createdAt,
  ).run()
}

export async function insertTripEvent(db: D1Database, event: AuthoredTripEvent) {
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
    encodeTripEventPayload(event.payload),
    event.createdAt,
  ).run()
}

function parsePayload(row: TripEventRow): JsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload_json)
  } catch {
    throw new Error(`Trip event ${row.id} payload is malformed JSON`)
  }

  if (!isJsonObject(parsed)) {
    throw new Error(`Trip event ${row.id} payload must be a JSON object`)
  }

  return parsed
}

function decodeEntityCreatePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'entity.create' }>['payload'] {
  if (!isTripEntityType(payload.entityType) || !isJsonObject(payload.entity)) {
    throw new Error(`Trip event ${eventId} payload does not match entity.create`)
  }
  if (!isValidEntity(payload.entityType, payload.entity)) {
    throw new Error(`Trip event ${eventId} payload does not match entity.create`)
  }

  return { entityType: payload.entityType, entity: payload.entity } as Extract<TripEvent, { type: 'entity.create' }>['payload']
}

function decodeEntityUpdatePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'entity.update' }>['payload'] {
  if (isTripEntityType(payload.entityType) && typeof payload.id === 'string' && isJsonObject(payload.patch)) {
    if (Object.hasOwn(payload.patch, 'id') || Object.hasOwn(payload.patch, 'type')) {
      throw new Error(`Trip event ${eventId} payload does not match entity.update`)
    }
    if (!isValidEntityPatch(payload.entityType, payload.patch)) {
      throw new Error(`Trip event ${eventId} payload does not match entity.update`)
    }

    return { entityType: payload.entityType, id: payload.id, patch: payload.patch }
  }

  throw new Error(`Trip event ${eventId} payload does not match entity.update`)
}

function decodeEntityDeletePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'entity.delete' }>['payload'] {
  if (isTripEntityType(payload.entityType) && typeof payload.id === 'string') {
    return { entityType: payload.entityType, id: payload.id }
  }

  throw new Error(`Trip event ${eventId} payload does not match entity.delete`)
}

type DecodedTripEventBase = Pick<TripEvent, 'id' | 'tripId' | 'version' | 'previousVersion' | 'actorUserId' | 'createdAt'>

function buildEntityCreateEvent(
  base: DecodedTripEventBase,
  payload: Extract<TripEvent, { type: 'entity.create' }>['payload'],
): Extract<TripEvent, { type: 'entity.create' }> {
  return { ...base, type: 'entity.create', payload } as Extract<TripEvent, { type: 'entity.create' }>
}

function buildEntityUpdateEvent(
  base: DecodedTripEventBase,
  payload: Extract<TripEvent, { type: 'entity.update' }>['payload'],
): Extract<TripEvent, { type: 'entity.update' }> {
  return { ...base, type: 'entity.update', payload } as Extract<TripEvent, { type: 'entity.update' }>
}

function buildEntityDeleteEvent(
  base: DecodedTripEventBase,
  payload: Extract<TripEvent, { type: 'entity.delete' }>['payload'],
): Extract<TripEvent, { type: 'entity.delete' }> {
  return { ...base, type: 'entity.delete', payload } as Extract<TripEvent, { type: 'entity.delete' }>
}

function decodePageNoteUpdatePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'pageNote.update' }>['payload'] {
  if (typeof payload.pageId === 'string' && typeof payload.value === 'string') {
    return { pageId: payload.pageId, value: payload.value }
  }

  throw new Error(`Trip event ${eventId} payload does not match pageNote.update`)
}

function decodeUiStateUpdatePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'uiState.update' }>['payload'] {
  const update: {
    searchQuery?: string
    timeline?: Partial<TripUiState['timeline']>
    map?: Partial<TripUiState['map']>
  } = {}

  for (const key of Object.keys(payload)) {
    if (key !== 'searchQuery' && key !== 'timeline' && key !== 'map') {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
  }

  if (payload.searchQuery !== undefined) {
    if (typeof payload.searchQuery !== 'string') {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
    update.searchQuery = payload.searchQuery
  }

  if (payload.timeline !== undefined) {
    if (!isJsonObject(payload.timeline)) {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }

    update.timeline = decodeTimelineUpdate(eventId, payload.timeline)
  }

  if (payload.map !== undefined) {
    if (!isJsonObject(payload.map)) {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }

    update.map = decodeMapUpdate(eventId, payload.map)
  }

  return update as Extract<TripEvent, { type: 'uiState.update' }>['payload']
}

function decodeTimelineUpdate(eventId: string, payload: JsonObject): Partial<TripUiState['timeline']> {
  const update: Partial<TripUiState['timeline']> = {}

  for (const key of Object.keys(payload)) {
    if (key !== 'mode' && key !== 'cursorSlot') {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
  }

  if (payload.mode !== undefined) {
    if (typeof payload.mode !== 'string') {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
    update.mode = payload.mode
  }

  if (payload.cursorSlot !== undefined) {
    if (typeof payload.cursorSlot !== 'number' || !Number.isFinite(payload.cursorSlot)) {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
    update.cursorSlot = payload.cursorSlot
  }

  return update
}

function decodeMapUpdate(eventId: string, payload: JsonObject): Partial<TripUiState['map']> {
  const update: Partial<TripUiState['map']> = {}

  for (const key of Object.keys(payload)) {
    if (
      key !== 'showRoutes' &&
      key !== 'showFacilities' &&
      key !== 'showTraffic' &&
      key !== 'focusFamilyId' &&
      key !== 'focusDayId'
    ) {
      throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
    }
  }

  for (const key of ['showRoutes', 'showFacilities', 'showTraffic'] as const) {
    if (payload[key] !== undefined) {
      if (typeof payload[key] !== 'boolean') {
        throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
      }
      update[key] = payload[key]
    }
  }

  for (const key of ['focusFamilyId', 'focusDayId'] as const) {
    if (payload[key] !== undefined) {
      if (typeof payload[key] !== 'string') {
        throw new Error(`Trip event ${eventId} payload does not match uiState.update`)
      }
      update[key] = payload[key]
    }
  }

  return update
}

function decodeTripMetaUpdatePayload(eventId: string, payload: JsonObject): Extract<TripEvent, { type: 'trip.meta.update' }>['payload'] {
  if (payload.title === undefined || typeof payload.title === 'string') {
    return { title: payload.title }
  }

  throw new Error(`Trip event ${eventId} payload does not match trip.meta.update`)
}

function isTripEntityType(value: JsonValue | undefined): value is TripEntityType {
  return typeof value === 'string' && TRIP_ENTITY_TYPES.has(value as TripEntityType)
}

type ValueValidator = (value: JsonValue) => boolean

const isString: ValueValidator = (value) => typeof value === 'string'
const isBoolean: ValueValidator = (value) => typeof value === 'boolean'
const isFiniteNumber: ValueValidator = (value) => typeof value === 'number' && Number.isFinite(value)
const isStringOrNull: ValueValidator = (value) => typeof value === 'string' || value === null
const isStringArray: ValueValidator = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

const BASE_FIELD_VALIDATORS: Record<string, ValueValidator> = {
  id: isString,
  type: isTripEntityType,
  title: isString,
  name: isString,
  dayId: isString,
  note: isString,
  summary: isString,
  linkedEntityKeys: isStringArray,
  taskIds: isStringArray,
  createdByFamilyId: isStringOrNull,
  createdAt: isString,
  lastEditedByFamilyId: isStringOrNull,
  lastEditedAt: isString,
}

const ENTITY_FIELD_VALIDATORS: Record<TripEntityType, Record<string, ValueValidator>> = {
  family: {
    ...BASE_FIELD_VALIDATORS,
    origin: isString,
    shortOrigin: isString,
    originAddress: isString,
    originCoordinates: isCoordinates,
    arrivalDayId: isString,
    status: isString,
    eta: isString,
    driveTime: isString,
    headcount: isString,
    vehicle: isString,
    vehicleLabel: isString,
    responsibility: isString,
    readiness: isFiniteNumber,
    routeSummary: isString,
    plannedStopIds: isStringArray,
  },
  location: {
    ...BASE_FIELD_VALIDATORS,
    category: isString,
    address: isString,
    coordinates: isCoordinates,
    accessNote: isStringOrNull,
    directionsNote: isStringOrNull,
    parkingNote: isStringOrNull,
    lockNote: isStringOrNull,
    wifiNetwork: isStringOrNull,
    wifiPassword: isStringOrNull,
    externalUrl: isStringOrNull,
    websiteUrl: isStringOrNull,
    phoneNumber: isStringOrNull,
  },
  route: {
    ...BASE_FIELD_VALIDATORS,
    familyId: isString,
    tone: isString,
    dashed: isBoolean,
    originCoordinates: isCoordinates,
    destinationLocationId: isString,
    stopLocationIds: isStringArray,
    path: isCoordinatesArray,
    linkedEntityKey: isString,
    simulationStartSlot: isFiniteNumber,
    simulationEndSlot: isFiniteNumber,
    durationSeconds: isFiniteNumber,
    durationText: isString,
    distanceMeters: isFiniteNumber,
    distanceText: isString,
    simulationMilestones: isSimulationMilestones,
  },
  itineraryItem: {
    ...BASE_FIELD_VALIDATORS,
    rowId: isString,
    startSlot: isFiniteNumber,
    span: isFiniteNumber,
    color: isString,
    routeId: isString,
    locationId: isStringOrNull,
    familyIds: isStringArray,
    status: isString,
    riskLevel: isString,
  },
  meal: {
    ...BASE_FIELD_VALIDATORS,
    timeLabel: isString,
    startSlot: isFiniteNumber,
    status: isString,
    owner: isString,
    locationId: isStringOrNull,
    reservationType: isString,
  },
  activity: {
    ...BASE_FIELD_VALIDATORS,
    window: isString,
    status: isString,
    description: isString,
    backup: isString,
    locationId: isStringOrNull,
    riskLevel: isString,
    weatherSensitivity: isString,
  },
  stayItem: {
    ...BASE_FIELD_VALIDATORS,
    category: isString,
    locationId: isStringOrNull,
  },
  expense: {
    ...BASE_FIELD_VALIDATORS,
    payer: isString,
    amount: isFiniteNumber,
    split: isString,
    allocationMode: isAllocationMode,
    allocations: isNumericRecord,
    settled: isBoolean,
  },
  task: {
    ...BASE_FIELD_VALIDATORS,
    status: isString,
    ownerFamilyId: isStringOrNull,
  },
}

const REQUIRED_ENTITY_FIELDS: Record<TripEntityType, readonly string[]> = {
  family: ['id', 'type', 'title'],
  location: ['id', 'type', 'title', 'category'],
  route: ['id', 'type', 'title'],
  itineraryItem: ['id', 'type', 'title', 'startSlot'],
  meal: ['id', 'type', 'title'],
  activity: ['id', 'type', 'title'],
  stayItem: ['id', 'type', 'title'],
  expense: ['id', 'type', 'title', 'payer', 'amount', 'split', 'allocationMode', 'allocations', 'settled'],
  task: ['id', 'type', 'title', 'status'],
}

function isValidEntity(entityType: TripEntityType, entity: JsonObject): boolean {
  if (entity.type !== entityType) {
    return false
  }

  for (const field of REQUIRED_ENTITY_FIELDS[entityType]) {
    if (!Object.hasOwn(entity, field)) {
      return false
    }
  }

  return isValidEntityShape(entityType, entity)
}

function isValidEntityPatch(entityType: TripEntityType, patch: JsonObject): boolean {
  return isValidEntityShape(entityType, patch)
}

function isValidEntityShape(entityType: TripEntityType, values: JsonObject): boolean {
  const validators = ENTITY_FIELD_VALIDATORS[entityType]

  for (const [key, value] of Object.entries(values)) {
    const validator = validators[key]
    if (!validator) {
      if (entityType === 'location') {
        continue
      }
      return false
    }
    if (!validator(value)) {
      return false
    }
  }

  return true
}

function isCoordinates(value: JsonValue): boolean {
  return isJsonObject(value) && isFiniteNumber(value.lat) && isFiniteNumber(value.lng)
}

function isCoordinatesArray(value: JsonValue): boolean {
  return Array.isArray(value) && value.every(isCoordinates)
}

function isSimulationMilestones(value: JsonValue): boolean {
  return Array.isArray(value) && value.every((item) =>
    isJsonObject(item) && isFiniteNumber(item.t) && isFiniteNumber(item.progress),
  )
}

function isAllocationMode(value: JsonValue): boolean {
  return value === 'equal' || value === 'manual' || value === 'individual'
}

function isNumericRecord(value: JsonValue): boolean {
  return isJsonObject(value) && Object.values(value).every(isFiniteNumber)
}
