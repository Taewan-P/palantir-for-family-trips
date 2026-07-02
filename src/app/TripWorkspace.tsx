import { useEffect, useState } from 'react'

import App from '../App'
import type { TripDocument } from '../shared/trip-types'
import { apiGet } from './api-client'
import { loginRoute } from './LoginPage'
import { navigate } from './router'

type TripWorkspaceProps = {
  tripId?: string
  initialDocument?: TripDocument
  readOnly?: boolean
}

type TripRole = 'owner' | 'editor'

export type TripMember = {
  userId: string
  email: string
  name: string
  avatarUrl: string | null
  role: TripRole
  createdAt: string
}

type TripResponse = {
  trip: TripDocument
  version: number
  role: TripRole
  members: TripMember[]
}

export function TripWorkspace({ tripId, initialDocument, readOnly = false }: TripWorkspaceProps) {
  const [document, setDocument] = useState<TripDocument | null>(initialDocument ?? null)
  const [role, setRole] = useState<TripRole>('owner')
  const [members, setMembers] = useState<TripMember[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId || initialDocument) {
      setDocument(initialDocument ?? null)
      setRole('owner')
      setMembers([])
      setError(null)
      return undefined
    }

    let cancelled = false
    setDocument(null)
    setError(null)

    apiGet<TripResponse>(`/api/trips/${encodeURIComponent(tripId)}`).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDocument(result.data.trip)
        setRole(result.data.role)
        setMembers(result.data.members)
      } else if (result.error.code === 'unauthorized') {
        navigate(loginRoute(`/trips/${tripId}`))
      } else {
        setError(result.error.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [initialDocument, tripId])

  if (!tripId && !document) {
    return <App readOnly={readOnly} />
  }

  if (error) {
    return <main className="min-h-screen bg-[#0d1117] p-6 text-[#F85149]">{error}</main>
  }

  if (!document) {
    return <main className="min-h-screen bg-[#0d1117] p-6 text-[#8B949E]">Loading trip...</main>
  }

  return <App serviceTripId={tripId} tripRole={role} serviceTripMembers={members} initialServiceDocument={document} readOnly={readOnly} />
}
