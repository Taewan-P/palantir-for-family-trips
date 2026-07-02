import { useCallback, useEffect, useRef, useState } from 'react'

import { applyTripEvent } from '../shared/trip-reducer'
import { normalizeMemberTripCopy } from '../shared/trip-template'
import type { TripDocument, TripEvent } from '../shared/trip-types'

type TripRoomStatus = 'connecting' | 'open' | 'closed' | 'error'

type TripRoomSnapshotMessage = {
  type: 'snapshot'
  document: TripDocument
  version: number
}

type TripRoomEventAcceptedMessage = {
  type: 'event.accepted'
  commandId?: string
  event: TripEvent
  version: number
}

type TripRoomEventRejectedMessage = {
  type: 'event.rejected'
  reason: 'stale_version'
  document: TripDocument
  version: number
}

type TripRoomMessage = TripRoomSnapshotMessage | TripRoomEventAcceptedMessage | TripRoomEventRejectedMessage

export type TripRoomState = {
  document: TripDocument | null
  version: number
  status: TripRoomStatus
  sendCommand: (command: object) => void
}

export function useTripRoom(tripId: string | null | undefined): TripRoomState {
  const socketRef = useRef<WebSocket | null>(null)
  const pendingCommandsRef = useRef<object[]>([])
  const inFlightCommandRef = useRef<object | null>(null)
  const versionRef = useRef(0)
  const [document, setDocument] = useState<TripDocument | null>(null)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState<TripRoomStatus>('connecting')

  const flushCommandQueue = useCallback(() => {
    const socket = socketRef.current
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      inFlightCommandRef.current ||
      !pendingCommandsRef.current.length
    ) {
      return
    }

    const command = pendingCommandsRef.current.shift()
    if (!command) return

    inFlightCommandRef.current = command

    try {
      socket.send(JSON.stringify(withCommandBaseVersion(command, versionRef.current)))
    } catch {
      pendingCommandsRef.current.unshift(command)
      inFlightCommandRef.current = null
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!tripId) {
      pendingCommandsRef.current = []
      inFlightCommandRef.current = null
      versionRef.current = 0
      setDocument(null)
      setVersion(0)
      setStatus('closed')
      return undefined
    }

    const socket = new WebSocket(tripRoomUrl(tripId))
    const isCurrentSocket = () => socketRef.current === socket

    socketRef.current = socket
    pendingCommandsRef.current = []
    inFlightCommandRef.current = null
    versionRef.current = 0
    setStatus('connecting')

    socket.addEventListener('open', () => {
      if (isCurrentSocket()) {
        setStatus('open')
        flushCommandQueue()
      }
    })
    socket.addEventListener('close', () => {
      if (isCurrentSocket()) setStatus('closed')
    })
    socket.addEventListener('error', () => {
      if (isCurrentSocket()) setStatus('error')
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      if (!isCurrentSocket()) return

      const message = parseTripRoomMessage(event.data)

      if (!message) {
        setStatus('error')
        return
      }

      if (message.type === 'snapshot') {
        inFlightCommandRef.current = null
        versionRef.current = message.version
        setDocument(normalizeMemberTripCopy(message.document))
        setVersion(message.version)
        flushCommandQueue()
        return
      }

      if (message.type === 'event.accepted') {
        versionRef.current = message.version
        if (!message.commandId || commandId(inFlightCommandRef.current) === message.commandId) {
          inFlightCommandRef.current = null
        }
        setDocument((current) => (current ? applyTripEvent(current, message.event) : current))
        setVersion(message.version)
        flushCommandQueue()
        return
      }

      const rejectedCommand = inFlightCommandRef.current
      inFlightCommandRef.current = null
      versionRef.current = message.version
      if (rejectedCommand) {
        pendingCommandsRef.current.unshift(rejectedCommand)
      }
      setDocument(normalizeMemberTripCopy(message.document))
      setVersion(message.version)
      flushCommandQueue()
    })

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null
      }
      socket.close()
    }
  }, [flushCommandQueue, tripId])

  const sendCommand = useCallback((command: object) => {
    pendingCommandsRef.current.push(command)
    flushCommandQueue()
  }, [flushCommandQueue])

  return { document, version, status, sendCommand }
}

function tripRoomUrl(tripId: string): string {
  const baseUrl = import.meta.env.VITE_WS_BASE_URL || window.location.origin.replace(/^http/, 'ws')
  return `${baseUrl}/api/trips/${encodeURIComponent(tripId)}/live`
}

function parseTripRoomMessage(data: unknown): TripRoomMessage | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    return toTripRoomMessage(JSON.parse(data))
  } catch {
    return null
  }
}

function toTripRoomMessage(value: unknown): TripRoomMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }

  if (value.type === 'snapshot' && isTripDocument(value.document) && isVersion(value.version)) {
    return { type: 'snapshot', document: value.document, version: value.version }
  }

  if (
    value.type === 'event.accepted' &&
    (value.commandId === undefined || typeof value.commandId === 'string') &&
    isTripEvent(value.event) &&
    isVersion(value.version)
  ) {
    return { type: 'event.accepted', commandId: value.commandId, event: value.event, version: value.version }
  }

  if (
    value.type === 'event.rejected' &&
    value.reason === 'stale_version' &&
    isTripDocument(value.document) &&
    isVersion(value.version)
  ) {
    return { type: 'event.rejected', reason: 'stale_version', document: value.document, version: value.version }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function withCommandBaseVersion(command: object, baseVersion: number): object {
  return isRecord(command) ? { ...command, baseVersion } : command
}

function commandId(command: object | null): string | null {
  return isRecord(command) && typeof command.id === 'string' ? command.id : null
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTripDocument(value: unknown): value is TripDocument {
  if (!isRecord(value) || !isRecord(value.selection) || !isRecord(value.ui)) {
    return false
  }

  return (
    typeof value.selectedPage === 'string' &&
    isRecord(value.pageNotes) &&
    isRecord(value.pageNoteMeta) &&
    Array.isArray(value.families) &&
    Array.isArray(value.locations) &&
    Array.isArray(value.routes) &&
    Array.isArray(value.itineraryItems) &&
    Array.isArray(value.meals) &&
    Array.isArray(value.activities) &&
    Array.isArray(value.stayItems) &&
    Array.isArray(value.expenses) &&
    Array.isArray(value.tasks)
  )
}

function isTripEvent(value: unknown): value is TripEvent {
  return isRecord(value) && typeof value.type === 'string' && isRecord(value.payload)
}
