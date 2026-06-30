import { useCallback, useEffect, useRef, useState } from 'react'

import { applyTripEvent } from '../shared/trip-reducer'
import type { TripDocument, TripEvent } from '../shared/trip-types'

type TripRoomStatus = 'connecting' | 'open' | 'closed' | 'error'

type TripRoomSnapshotMessage = {
  type: 'snapshot'
  document: TripDocument
  version: number
}

type TripRoomEventAcceptedMessage = {
  type: 'event.accepted'
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

export function useTripRoom(tripId: string): TripRoomState {
  const socketRef = useRef<WebSocket | null>(null)
  const [document, setDocument] = useState<TripDocument | null>(null)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState<TripRoomStatus>('connecting')

  useEffect(() => {
    const socket = new WebSocket(tripRoomUrl(tripId))

    socketRef.current = socket
    setStatus('connecting')

    socket.addEventListener('open', () => setStatus('open'))
    socket.addEventListener('close', () => setStatus('closed'))
    socket.addEventListener('error', () => setStatus('error'))
    socket.addEventListener('message', (event: MessageEvent) => {
      const message = parseTripRoomMessage(event.data)

      if (!message) {
        setStatus('error')
        return
      }

      if (message.type === 'snapshot') {
        setDocument(message.document)
        setVersion(message.version)
        return
      }

      if (message.type === 'event.accepted') {
        setDocument((current) => (current ? applyTripEvent(current, message.event) : current))
        setVersion(message.version)
        return
      }

      setDocument(message.document)
      setVersion(message.version)
    })

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null
      }
      socket.close()
    }
  }, [tripId])

  const sendCommand = useCallback((command: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(command))
    }
  }, [])

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

  if (value.type === 'event.accepted' && isTripEvent(value.event) && isVersion(value.version)) {
    return { type: 'event.accepted', event: value.event, version: value.version }
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
