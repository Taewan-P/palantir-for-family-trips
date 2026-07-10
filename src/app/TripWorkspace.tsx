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

type MeResponse = {
  user: {
    id: string
  }
}

export function TripWorkspace({ tripId, initialDocument, readOnly = false }: TripWorkspaceProps) {
  const [document, setDocument] = useState<TripDocument | null>(initialDocument ?? null)
  const [role, setRole] = useState<TripRole>('owner')
  const [members, setMembers] = useState<TripMember[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId || initialDocument) {
      setDocument(initialDocument ?? null)
      setRole('owner')
      setMembers([])
      setViewerUserId(null)
      setError(null)
      return undefined
    }

    let cancelled = false
    setDocument(null)
    setError(null)

    Promise.all([
      apiGet<TripResponse>(`/api/trips/${encodeURIComponent(tripId)}`),
      apiGet<MeResponse>('/api/me'),
    ]).then(([result, meResult]) => {
      if (cancelled) return
      if (result.ok && meResult.ok) {
        setDocument(result.data.trip)
        setRole(result.data.role)
        setMembers(result.data.members)
        setViewerUserId(meResult.data.user.id)
      } else if ((!result.ok && result.error.code === 'unauthorized') || (!meResult.ok && meResult.error.code === 'unauthorized')) {
        navigate(loginRoute(`/trips/${tripId}`))
      } else {
        setError(!result.ok ? result.error.message : meResult.ok ? 'Unable to load account' : meResult.error.message)
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

  return (
    <App
      key={tripId || 'shared'}
      serviceTripId={tripId}
      tripRole={role}
      serviceTripMembers={members}
      viewerUserId={viewerUserId || undefined}
      initialServiceDocument={document}
      readOnly={readOnly}
    />
  )
}
