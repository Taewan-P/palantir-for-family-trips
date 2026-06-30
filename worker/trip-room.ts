import { createId } from '../src/shared/ids'
import { isJsonObject } from '../src/shared/json'
import { applyTripEvent } from '../src/shared/trip-reducer'
import type { TripDocument, TripEvent } from '../src/shared/trip-types'
import { hashToken } from './auth'
import {
  commitTripEvent,
  decodeTripEventPayload,
  findMembership,
  findSessionUser,
  loadHydratedTripSnapshotWithVersion,
} from './db'
import type { Env } from './env'
import { parseCookie } from './http'

const SNAPSHOT_INTERVAL = 25

export type TripCommand = Omit<TripEvent, 'id' | 'tripId' | 'version' | 'previousVersion' | 'actorUserId' | 'createdAt'> & {
  id: string
  baseVersion: number
}

export type AcceptCommandInput = {
  tripId: string
  actorUserId: string
  document: TripDocument
  version: number
  now: string
  command: TripCommand
}

export type AcceptCommandResult =
  | { ok: true; event: TripEvent; document: TripDocument; version: number }
  | { ok: false; reason: 'stale_version' }

export function acceptCommand(input: AcceptCommandInput): AcceptCommandResult {
  if (input.command.baseVersion !== input.version) {
    return { ok: false, reason: 'stale_version' }
  }

  const event = {
    id: createId('event'),
    tripId: input.tripId,
    version: input.version + 1,
    previousVersion: input.version,
    actorUserId: input.actorUserId,
    createdAt: input.now,
    type: input.command.type,
    payload: input.command.payload,
  } as TripEvent

  return {
    ok: true,
    event,
    document: applyTripEvent(input.document, event),
    version: event.version,
  }
}

export class TripRoom implements DurableObject {
  private readonly sockets = new Set<WebSocket>()
  private document: TripDocument | null = null
  private version = 0
  private acceptedSinceSnapshot = 0
  private messageQueue: Promise<void> = Promise.resolve()

  constructor(_state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const tripId = tripIdFromPath(new URL(request.url).pathname)
    if (!tripId) return new Response('Trip not found', { status: 404 })

    const user = await this.authenticate(request)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const membership = await findMembership(this.env.DB, tripId, user.id)
    if (!membership) return new Response('Forbidden', { status: 403 })

    const hydrated = await this.load(tripId)
    if (!hydrated) return new Response('Trip snapshot not found', { status: 404 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    this.sockets.add(server)
    server.addEventListener('close', () => this.sockets.delete(server))
    server.addEventListener('error', () => this.sockets.delete(server))
    server.addEventListener('message', (event) => this.enqueueMessage(server, tripId, user.id, event.data))
    this.send(server, { type: 'snapshot', document: this.document, version: this.version })

    return new Response(null, { status: 101, webSocket: client })
  }

  private async authenticate(request: Request): Promise<{ id: string } | null> {
    const token = parseCookie(request.headers.get('cookie'), this.env.SESSION_COOKIE_NAME)
    if (!token) return null
    return findSessionUser(this.env.DB, await hashToken(token, this.env.SESSION_SECRET), new Date().toISOString())
  }

  private async load(tripId: string): Promise<boolean> {
    if (this.document) return true
    const hydrated = await loadHydratedTripSnapshotWithVersion(this.env.DB, tripId)
    if (!hydrated) return false
    this.document = hydrated.document
    this.version = hydrated.version
    this.acceptedSinceSnapshot = this.version % SNAPSHOT_INTERVAL
    return true
  }

  private async handleMessage(socket: WebSocket, tripId: string, actorUserId: string, data: unknown): Promise<void> {
    if (!this.document) {
      this.send(socket, { type: 'error', reason: 'not_loaded' })
      return
    }

    const command = parseTripCommand(data)
    if (!command) {
      this.send(socket, { type: 'event.rejected', reason: 'malformed_command' })
      return
    }

    const now = new Date().toISOString()
    let result: AcceptCommandResult
    try {
      result = acceptCommand({
        tripId,
        actorUserId,
        document: this.document,
        version: this.version,
        now,
        command,
      })
    } catch {
      this.send(socket, { type: 'event.rejected', reason: 'malformed_command' })
      return
    }

    if (!result.ok) {
      this.send(socket, { type: 'event.rejected', reason: result.reason, version: this.version, document: this.document })
      return
    }

    const shouldSnapshot = this.acceptedSinceSnapshot + 1 >= SNAPSHOT_INTERVAL
    await commitTripEvent(this.env.DB, {
      event: result.event as TripEvent & { actorUserId: string },
      updatedAt: now,
      snapshot: shouldSnapshot
        ? { id: createId('snapshot'), document: result.document, userId: actorUserId }
        : undefined,
    })

    this.document = result.document
    this.version = result.version
    if (shouldSnapshot) {
      this.acceptedSinceSnapshot = 0
    } else {
      this.acceptedSinceSnapshot += 1
    }

    this.broadcast({ type: 'event.accepted', commandId: command.id, event: result.event, version: result.version })
  }

  private broadcast(message: unknown): void {
    for (const socket of this.sockets) {
      this.send(socket, message)
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      this.sockets.delete(socket)
    }
  }

  private enqueueMessage(socket: WebSocket, tripId: string, actorUserId: string, data: unknown): void {
    this.messageQueue = this.messageQueue
      .then(() => this.handleMessage(socket, tripId, actorUserId, data))
      .catch(() => {
        this.send(socket, { type: 'error', reason: 'command_failed' })
      })
  }
}

function tripIdFromPath(pathname: string): string | null {
  return /^\/api\/trips\/([^/]+)\/live$/.exec(pathname)?.[1] ?? null
}

export function parseTripCommand(data: unknown): TripCommand | null {
  if (typeof data !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  const value = isJsonObject(parsed) && isJsonObject(parsed.command) ? parsed.command : parsed
  if (!isJsonObject(value) || typeof value.id !== 'string' || !Number.isInteger(value.baseVersion)) return null
  if (typeof value.type !== 'string' || !isJsonObject(value.payload)) return null
  if (!isTripEventType(value.type)) return null

  let payload: TripEvent['payload']
  try {
    payload = decodeTripEventPayload(value.type, value.payload, value.id)
  } catch {
    return null
  }

  return {
    id: value.id,
    baseVersion: value.baseVersion,
    type: value.type,
    payload,
  } as TripCommand
}

function isTripEventType(type: string): type is TripEvent['type'] {
  return type === 'entity.create'
    || type === 'entity.update'
    || type === 'entity.delete'
    || type === 'pageNote.update'
    || type === 'uiState.update'
    || type === 'trip.meta.update'
}
