import { Link } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiPost } from './api-client'
import { authStartHref } from './LoginPage'
import { navigate } from './router'

type InviteAcceptResponse = {
  tripId: string
  role: 'editor'
}

type InviteStatus = 'accepting' | 'sign-in-required' | 'error'

export function InvitePage({ token }: { token: string }) {
  const [status, setStatus] = useState<InviteStatus>('accepting')
  const [message, setMessage] = useState('Joining trip...')

  useEffect(() => {
    let cancelled = false

    apiPost<InviteAcceptResponse>(`/api/invites/${encodeURIComponent(token)}/accept`).then((result) => {
      if (cancelled) return
      if (result.ok) {
        navigate(`/trips/${result.data.tripId}`)
        return
      }
      setMessage(result.error.message)
      setStatus(result.error.code === 'unauthorized' ? 'sign-in-required' : 'error')
    })

    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d1117] p-6 text-[#C9D1D9]">
      <section className="w-[380px] border border-[#30363D] bg-[#161B22] p-6">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
          Family Ops
        </div>
        <h1 className="text-[18px] font-black uppercase tracking-[0.08em]">Join trip</h1>
        <p className={`mt-4 text-[11px] ${status === 'error' ? 'text-[#F85149]' : 'text-[#8B949E]'}`}>
          {message}
        </p>
        {status === 'sign-in-required' ? (
          <a
            className="mt-6 flex items-center justify-center gap-2 border border-[#30363D] bg-[#0d1117] px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.14em] text-[#C9D1D9] transition-colors hover:border-[#58A6FF]"
            href={authStartHref(
              import.meta.env.VITE_API_BASE_URL,
              import.meta.env.DEV,
              undefined,
              `/invites/${token}`,
            )}
          >
            <Link size={14} />
            Continue with Google
          </a>
        ) : null}
      </section>
    </main>
  )
}
