import { Archive, ArrowRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { CreateGuidedTripRequest } from '../shared/trip-types'
import { GuidedTripSetupForm } from './GuidedTripSetupForm'
import { apiDelete, apiGet, apiPost } from './api-client'
import { loginRoute } from './LoginPage'
import { navigate } from './router'

type TripSummary = {
  id: string
  title: string
  role: 'owner' | 'editor'
  updatedAt: string
}

type TripsResponse = {
  trips: TripSummary[]
}

type CreateTripResponse = {
  trip: {
    id: string
  }
}

type ArchiveTripResponse = {
  archived: true
}

export function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    apiGet<TripsResponse>('/api/trips').then((result) => {
      if (cancelled) return
      if (result.ok) {
        setTrips(result.data.trips)
        setError(null)
      } else if (result.error.code === 'unauthorized') {
        navigate(loginRoute('/trips'))
      } else {
        setError(result.error.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function createTrip(request: CreateGuidedTripRequest) {
    setCreating(true)
    setError(null)

    const result = await apiPost<CreateTripResponse>('/api/trips', request)
    setCreating(false)

    if (result.ok) {
      navigate(`/trips/${result.data.trip.id}`)
    } else if (result.error.code === 'unauthorized') {
      navigate(loginRoute('/trips'))
    } else {
      setError(result.error.message)
    }
  }

  async function archiveTrip(trip: TripSummary) {
    if (!window.confirm(`Archive ${trip.title}?`)) return
    setError(null)

    const result = await apiDelete<ArchiveTripResponse>(`/api/trips/${encodeURIComponent(trip.id)}`)
    if (result.ok) {
      setTrips((current) => current.filter((item) => item.id !== trip.id))
    } else if (result.error.code === 'unauthorized') {
      navigate(loginRoute('/trips'))
    } else {
      setError(result.error.message)
    }
  }

  return (
    <main className="min-h-screen bg-[#0d1117] p-6 text-[#C9D1D9]">
      <header className="mb-5 flex items-center justify-between gap-4 border-b border-[#30363D] pb-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#3FB950]">
            UNCLASSIFIED // FAMILY OPS
          </div>
          <h1 className="mt-2 text-[18px] font-black uppercase tracking-[0.08em]">Trips</h1>
        </div>
        <button
          className="inline-flex items-center gap-2 border border-[#58A6FF]/50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/10 disabled:opacity-50"
          disabled={creating || setupOpen}
          onClick={() => {
            setSetupOpen(true)
            setError(null)
          }}
          type="button"
        >
          <Plus size={13} />
          New trip
        </button>
      </header>

      {error ? <div className="mb-4 border border-[#F85149] p-3 text-[11px] text-[#F85149]">{error}</div> : null}

      {setupOpen ? (
        <GuidedTripSetupForm
          busy={creating}
          error={null}
          onCancel={() => setSetupOpen(false)}
          onSubmit={createTrip}
        />
      ) : null}

      <div className="grid gap-2">
        {trips.map((trip) => (
          <div
            key={trip.id}
            className="grid grid-cols-[1fr_auto] items-center gap-4 border border-[#30363D] bg-[#161B22] p-4 text-left transition-colors hover:border-[#58A6FF]/50"
          >
            <button
              className="min-w-0 text-left"
              onClick={() => navigate(`/trips/${trip.id}`)}
              type="button"
            >
              <span className="block text-[12px] font-black uppercase tracking-[0.12em]">{trip.title}</span>
              <span className="mt-1 block font-mono text-[10px] text-[#8B949E]">
                {trip.role} / {trip.updatedAt}
              </span>
            </button>
            <div className="flex items-center gap-2">
              {trip.role === 'owner' ? (
                <button
                  className="inline-flex items-center gap-1.5 border border-[#30363D] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-[#8B949E] transition-colors hover:border-[#F85149]/50 hover:text-[#F85149]"
                  onClick={() => archiveTrip(trip)}
                  type="button"
                >
                  <Archive size={12} />
                  Archive
                </button>
              ) : null}
              <ArrowRight size={14} className="text-[#58A6FF]" />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
