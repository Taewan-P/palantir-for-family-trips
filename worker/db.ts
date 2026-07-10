import { isJsonObject, type JsonObject, type JsonValue } from '../src/shared/json'
import { replayTripEvents } from '../src/shared/trip-reducer'
import { normalizeMemberTripCopy } from '../src/shared/trip-template'
import type { TripDocument, TripEntityType, TripEvent, TripUiState } from '../src/shared/trip-types'

export type AppUserRow = {
  id: string
  email: string
  name: string
  avatar_url: string | null
}

export type TripListRow = {
  id: string
  title: string
  slug: string
  current_version: number
  role: 'owner' | 'editor'
  created_at: string
  updated_at: string
}

export type TripAccess = {
  exists: boolean
  role: 'owner' | 'editor' | null
}

export type TripMemberRow = {
  user_id: string
  email: string
  name: string
  avatar_url: string | null
  role: 'owner' | 'editor'
  created_at: string
}

const TRIP_ENTITY_TYPES = new Set<TripEntityType>([
  'day',
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

function parseTripDocumentJson(raw: string): TripDocument {
  return normalizeMemberTripCopy(JSON.parse(raw) as TripDocument)
}

export type AuthoredTripEvent = TripEvent & { actorUserId: string }

export type TripEventSnapshotWrite = {
  id: string
  document: TripDocument
  userId: string | null
}

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
      return buildEntityCreateEvent(base, decodeTripEventPayload(row.type, payload, row.id) as Extract<TripEvent, { type: 'entity.create' }>['payload'])
    case 'entity.update':
      return buildEntityUpdateEvent(base, decodeTripEventPayload(row.type, payload, row.id) as Extract<TripEvent, { type: 'entity.update' }>['payload'])
    case 'entity.delete':
      return buildEntityDeleteEvent(base, decodeTripEventPayload(row.type, payload, row.id) as Extract<TripEvent, { type: 'entity.delete' }>['payload'])
    case 'pageNote.update':
    case 'uiState.update':
    case 'trip.meta.update':
      return { ...base, type: row.type, payload: decodeTripEventPayload(row.type, payload, row.id) } as TripEvent
    default:
      throw new Error(`Trip event ${row.id} has unsupported type ${row.type}`)
  }
}

export function decodeTripEventPayload(
  type: TripEvent['type'],
  payload: JsonObject,
  eventId: string,
): TripEvent['payload'] {
  switch (type) {
    case 'entity.create':
      return decodeEntityCreatePayload(eventId, payload)
    case 'entity.update':
      return decodeEntityUpdatePayload(eventId, payload)
    case 'entity.delete':
      return decodeEntityDeletePayload(eventId, payload)
    case 'pageNote.update':
      return decodePageNoteUpdatePayload(eventId, payload)
    case 'uiState.update':
      return decodeUiStateUpdatePayload(eventId, payload)
    case 'trip.meta.update':
      return decodeTripMetaUpdatePayload(eventId, payload)
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

export async function getTripAccess(db: D1Database, tripId: string, userId: string): Promise<TripAccess> {
  const row = await db.prepare(`
    SELECT memberships.role
    FROM trips
    LEFT JOIN memberships ON memberships.trip_id = trips.id AND memberships.user_id = ?
    WHERE trips.id = ? AND trips.archived_at IS NULL
  `).bind(userId, tripId).first<{ role: 'owner' | 'editor' | null }>()

  return row ? { exists: true, role: row.role } : { exists: false, role: null }
}

export async function upsertGoogleUser(db: D1Database, input: {
  id: string
  googleSub: string
  email: string
  name: string
  avatarUrl: string | null
  now: string
}): Promise<AppUserRow> {
  const row = await db.prepare(`
    INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
    RETURNING id, email, name, avatar_url
  `).bind(
    input.id,
    input.googleSub,
    input.email,
    input.name,
    input.avatarUrl,
    input.now,
    input.now,
  ).first<AppUserRow>()

  if (!row) throw new Error('Failed to upsert Google user')
  return row
}

export async function createSession(db: D1Database, input: {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
}): Promise<void> {
  await db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(input.id, input.userId, input.tokenHash, input.expiresAt, input.createdAt).run()
}

export async function revokeSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

export async function listVisibleTrips(db: D1Database, userId: string): Promise<TripListRow[]> {
  const result = await db.prepare(`
    SELECT trips.id, trips.title, trips.slug, trips.current_version, memberships.role, trips.created_at, trips.updated_at
    FROM memberships
    INNER JOIN trips ON trips.id = memberships.trip_id
    WHERE memberships.user_id = ? AND trips.archived_at IS NULL
    ORDER BY trips.updated_at DESC
  `).bind(userId).all<TripListRow>()

  return result.results
}

export async function listTripMembers(db: D1Database, tripId: string): Promise<TripMemberRow[]> {
  const result = await db.prepare(`
    SELECT memberships.user_id, users.email, users.name, users.avatar_url, memberships.role, memberships.created_at
    FROM memberships
    INNER JOIN users ON users.id = memberships.user_id
    WHERE memberships.trip_id = ?
    ORDER BY memberships.created_at ASC
  `).bind(tripId).all<TripMemberRow>()

  return result.results
}

export async function createTrip(db: D1Database, input: {
  id: string
  title: string
  slug: string
  ownerUserId: string
  now: string
}): Promise<void> {
  await db.prepare(`
    INSERT INTO trips (id, title, slug, owner_user_id, current_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).bind(input.id, input.title, input.slug, input.ownerUserId, input.now, input.now).run()
}

export async function archiveTrip(db: D1Database, tripId: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE trips SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL
  `).bind(now, now, tripId).run()
}

export async function createMembership(db: D1Database, input: {
  tripId: string
  userId: string
  role: 'owner' | 'editor'
  createdAt: string
}): Promise<void> {
  await db.prepare(`
    INSERT INTO memberships (trip_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(input.tripId, input.userId, input.role, input.createdAt).run()
}

export async function createTripWithOwnerAndInitialSnapshot(db: D1Database, input: {
  tripId: string
  title: string
  slug: string
  ownerUserId: string
  snapshotId: string
  document: TripDocument
  now: string
}): Promise<void> {
  await db.batch([
    db.prepare(`
      INSERT INTO trips (id, title, slug, owner_user_id, current_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).bind(input.tripId, input.title, input.slug, input.ownerUserId, input.now, input.now),
    db.prepare(`
      INSERT INTO memberships (trip_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(input.tripId, input.ownerUserId, 'owner', input.now),
    db.prepare(`
      INSERT INTO trip_snapshots (id, trip_id, version, document_json, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      input.snapshotId,
      input.tripId,
      0,
      JSON.stringify(input.document),
      input.ownerUserId,
      input.now,
    ),
    db.prepare(`
      UPDATE trips SET latest_snapshot_id = ? WHERE id = ?
    `).bind(input.snapshotId, input.tripId),
  ])
}

export async function createInvite(db: D1Database, input: {
  id: string
  tripId: string
  tokenHash: string
  expiresAt: string
  createdByUserId: string
  createdAt: string
}): Promise<void> {
  await db.prepare(`
    INSERT INTO invites (id, trip_id, token_hash, role, expires_at, created_by_user_id, created_at)
    VALUES (?, ?, ?, 'editor', ?, ?, ?)
  `).bind(input.id, input.tripId, input.tokenHash, input.expiresAt, input.createdByUserId, input.createdAt).run()
}

export async function findActiveInvite(db: D1Database, tokenHash: string, now: string) {
  return db.prepare(`
    SELECT invites.id, invites.trip_id, invites.role
    FROM invites
    INNER JOIN trips ON trips.id = invites.trip_id AND trips.archived_at IS NULL
    WHERE invites.token_hash = ? AND invites.expires_at > ? AND invites.accepted_at IS NULL
  `).bind(tokenHash, now).first<{ id: string; trip_id: string; role: 'editor' }>()
}

export async function claimActiveInvite(db: D1Database, input: {
  tokenHash: string
  userId: string
  now: string
}) {
  return db.prepare(`
    UPDATE invites
    SET accepted_by_user_id = ?, accepted_at = ?
    WHERE token_hash = ? AND expires_at > ? AND accepted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM trips
        WHERE trips.id = invites.trip_id AND trips.archived_at IS NULL
      )
    RETURNING id, trip_id, role
  `).bind(input.userId, input.now, input.tokenHash, input.now).first<{ id: string; trip_id: string; role: 'editor' }>()
}

export async function claimInviteAndCreateMembership(db: D1Database, input: {
  tokenHash: string
  userId: string
  now: string
}) {
  const results = await db.batch([
    db.prepare(`
      UPDATE invites
      SET accepted_by_user_id = ?, accepted_at = ?
      WHERE token_hash = ? AND expires_at > ? AND accepted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM trips
          WHERE trips.id = invites.trip_id AND trips.archived_at IS NULL
        )
      RETURNING id, trip_id, role
    `).bind(input.userId, input.now, input.tokenHash, input.now),
    db.prepare(`
      INSERT INTO memberships (trip_id, user_id, role, created_at)
      SELECT invites.trip_id, ?, invites.role, ?
      FROM invites
      WHERE invites.token_hash = ?
        AND invites.accepted_by_user_id = ?
        AND invites.accepted_at = ?
        AND EXISTS (
          SELECT 1 FROM trips
          WHERE trips.id = invites.trip_id AND trips.archived_at IS NULL
        )
    `).bind(input.userId, input.now, input.tokenHash, input.userId, input.now),
  ]) as Array<D1Result<{ id: string; trip_id: string; role: 'editor' }>>

  return results[0]?.results?.[0] ?? null
}

export async function disableShareLinks(db: D1Database, tripId: string, now: string): Promise<void> {
  await db.prepare(`
    UPDATE share_links SET enabled = 0, updated_at = ? WHERE trip_id = ? AND enabled = 1
  `).bind(now, tripId).run()
}

export async function rotateShareLink(db: D1Database, input: {
  id: string
  tripId: string
  tokenHash: string
  createdByUserId: string
  now: string
}): Promise<void> {
  await db.batch([
    db.prepare(`
      UPDATE share_links SET enabled = 0, updated_at = ?
      WHERE trip_id = ? AND enabled = 1 AND policy = 'sanitized'
    `).bind(input.now, input.tripId),
    db.prepare(`
      INSERT INTO share_links (id, trip_id, token_hash, enabled, policy, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'sanitized', ?, ?, ?)
    `).bind(input.id, input.tripId, input.tokenHash, input.createdByUserId, input.now, input.now),
  ])
}

export async function findActiveShareLink(db: D1Database, tokenHash: string) {
  return db.prepare(`
    SELECT share_links.trip_id
    FROM share_links
    INNER JOIN trips ON trips.id = share_links.trip_id AND trips.archived_at IS NULL
    WHERE share_links.token_hash = ? AND share_links.enabled = 1 AND share_links.policy = 'sanitized'
  `).bind(tokenHash).first<{ trip_id: string }>()
}

export async function loadLatestTripSnapshot(db: D1Database, tripId: string): Promise<TripDocument | null> {
  const row = await db.prepare(`
    SELECT document_json FROM trip_snapshots WHERE trip_id = ? ORDER BY version DESC LIMIT 1
  `).bind(tripId).first<{ document_json: string }>()
  if (!row) return null
  return parseTripDocumentJson(row.document_json)
}

export function hydrateTripSnapshot(document: TripDocument, eventRows: readonly TripEventRow[]): TripDocument {
  return replayTripEvents(document, eventRows.map(decodeTripEventRow))
}

export async function loadHydratedTripSnapshot(db: D1Database, tripId: string): Promise<TripDocument | null> {
  const hydrated = await loadHydratedTripSnapshotWithVersion(db, tripId)
  return hydrated?.document ?? null
}

export async function loadHydratedTripSnapshotWithVersion(db: D1Database, tripId: string): Promise<{ document: TripDocument; version: number } | null> {
  const snapshot = await db.prepare(`
    SELECT version, document_json FROM trip_snapshots WHERE trip_id = ? ORDER BY version DESC LIMIT 1
  `).bind(tripId).first<{ version: number; document_json: string }>()
  if (!snapshot) return null

  const eventRows = await db.prepare(`
    SELECT id, trip_id, version, previous_version, actor_user_id, type, payload_json, created_at
    FROM trip_events
    WHERE trip_id = ? AND version > ?
    ORDER BY version ASC
  `).bind(tripId, snapshot.version).all<TripEventRow>()

  const events = eventRows.results.map(decodeTripEventRow)
  return {
    document: replayTripEvents(parseTripDocumentJson(snapshot.document_json), events),
    version: events.at(-1)?.version ?? snapshot.version,
  }
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

export async function updateTripCurrentVersion(db: D1Database, tripId: string, version: number, updatedAt: string): Promise<void> {
  await db.prepare(`
    UPDATE trips SET current_version = ?, updated_at = ? WHERE id = ?
  `).bind(version, updatedAt, tripId).run()
}

export async function updateTripLatestSnapshot(db: D1Database, tripId: string, snapshotId: string): Promise<void> {
  await db.prepare(`
    UPDATE trips SET latest_snapshot_id = ? WHERE id = ?
  `).bind(snapshotId, tripId).run()
}

export async function commitTripEvent(db: D1Database, input: {
  event: AuthoredTripEvent
  updatedAt: string
  snapshot?: TripEventSnapshotWrite
}): Promise<void> {
  const statements = [
    db.prepare(`
      INSERT INTO trip_events (id, trip_id, version, previous_version, actor_user_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.event.id,
      input.event.tripId,
      input.event.version,
      input.event.previousVersion,
      input.event.actorUserId,
      input.event.type,
      encodeTripEventPayload(input.event.payload),
      input.event.createdAt,
    ),
    db.prepare(`
      UPDATE trips SET current_version = ?, updated_at = ? WHERE id = ?
    `).bind(input.event.version, input.updatedAt, input.event.tripId),
  ]

  if (input.snapshot) {
    statements.push(
      db.prepare(`
        INSERT INTO trip_snapshots (id, trip_id, version, document_json, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        input.snapshot.id,
        input.event.tripId,
        input.event.version,
        JSON.stringify(input.snapshot.document),
        input.snapshot.userId,
        input.event.createdAt,
      ),
      db.prepare(`
        UPDATE trips SET latest_snapshot_id = ? WHERE id = ?
      `).bind(input.snapshot.id, input.event.tripId),
    )
  }

  await db.batch(statements)
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
  day: {
    ...BASE_FIELD_VALIDATORS,
    date: isString,
    shortLabel: isString,
    code: isString,
  },
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
    adults: isFiniteNumber,
    kids: isFiniteNumber,
    assignedUserId: isStringOrNull,
    assignedUserEmail: isStringOrNull,
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
    checkIn: isStringOrNull,
    checkOut: isStringOrNull,
    reservationNote: isStringOrNull,
    accessNote: isStringOrNull,
    directionsNote: isStringOrNull,
    parkingNote: isStringOrNull,
    lockNote: isStringOrNull,
    wifiNetwork: isStringOrNull,
    wifiPassword: isStringOrNull,
    hostName: isStringOrNull,
    coHostName: isStringOrNull,
    guestSummary: isStringOrNull,
    confirmationCode: isStringOrNull,
    vehicleFee: isStringOrNull,
    manualUrl: isStringOrNull,
    externalUrl: isStringOrNull,
    websiteUrl: isStringOrNull,
    phoneNumber: isStringOrNull,
    stopType: isString,
    placesQuery: isString,
    placeId: isStringOrNull,
    rating: isFiniteNumber,
    userRatingsTotal: isFiniteNumber,
    openingHours: isStringArray,
    photos: isLocationPhotoArray,
    livePhotos: isLocationMediaArray,
    basecampDrive: isBasecampDrive,
  },
  route: {
    ...BASE_FIELD_VALIDATORS,
    familyId: isString,
    origin: isString,
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
    address: isString,
    checkIn: isStringOrNull,
    checkOut: isStringOrNull,
    confirmationCode: isStringOrNull,
    accessNote: isStringOrNull,
    parkingNote: isStringOrNull,
    directionsNote: isStringOrNull,
    lockNote: isStringOrNull,
    wifiNetwork: isStringOrNull,
    wifiPassword: isStringOrNull,
    hostName: isStringOrNull,
    coHostName: isStringOrNull,
    guestSummary: isStringOrNull,
    reservationNote: isStringOrNull,
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
  day: ['id', 'type', 'title', 'date', 'shortLabel', 'code'],
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

function isLocationPhotoArray(value: JsonValue): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' || isLocationMedia(item))
}

function isLocationMediaArray(value: JsonValue): boolean {
  return Array.isArray(value) && value.every(isLocationMedia)
}

function isLocationMedia(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false
  const validators: Record<string, ValueValidator> = {
    id: isString,
    label: isString,
    imageUrl: isString,
    sourceUrl: isStringOrNull,
  }
  return Object.entries(value).every(([key, item]) => Boolean(validators[key]?.(item)))
}

function isBasecampDrive(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false
  const validators: Record<string, ValueValidator> = {
    durationText: isString,
    distanceText: isString,
  }
  return Object.entries(value).every(([key, item]) => Boolean(validators[key]?.(item)))
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
