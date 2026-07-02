import { useEffect, useState } from 'react'

import type { TripDocument } from '../shared/trip-types'
import { apiGet } from './api-client'
import { TripWorkspace } from './TripWorkspace'

type ShareResponse = {
  trip: TripDocument
  readOnly: true
}

export function SharePage({ token }: { token: string }) {
  const [document, setDocument] = useState<TripDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiGet<ShareResponse>(`/api/share/${encodeURIComponent(token)}`).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDocument(result.data.trip)
        setError(null)
      } else {
        setError(result.error.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return <main className="min-h-screen bg-[#0d1117] p-6 text-[#F85149]">{error}</main>
  }

  if (!document) {
    return <main className="min-h-screen bg-[#0d1117] p-6 text-[#8B949E]">Loading shared trip...</main>
  }

  return <TripWorkspace initialDocument={document} readOnly />
}
