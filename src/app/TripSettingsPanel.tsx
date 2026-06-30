import { useState } from 'react'
import { Link, Share2 } from 'lucide-react'

import { apiPost } from './api-client'

type InviteResponse = { inviteUrl: string }
type ShareResponse = { shareUrl: string }

export function TripSettingsPanel({ tripId, readOnly }: { tripId: string; readOnly: boolean }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function createInvite() {
    setError(null)
    const result = await apiPost<InviteResponse>(`/api/trips/${tripId}/invites`, { role: 'editor' })
    if (result.ok) setInviteUrl(result.data.inviteUrl)
    else setError(result.error.message)
  }

  async function createShare() {
    setError(null)
    const result = await apiPost<ShareResponse>(`/api/trips/${tripId}/share-link`, {})
    if (result.ok) setShareUrl(result.data.shareUrl)
    else setError(result.error.message)
  }

  return (
    <section className="border border-[#30363D] bg-[#161B22] p-4">
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Access</div>
      {error ? <div className="mb-3 text-[11px] text-[#F85149]">{error}</div> : null}
      <div className="grid gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={createInvite}
          className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          <Link size={13} />
          Create invite link
        </button>
        {inviteUrl ? (
          <input
            readOnly
            value={inviteUrl}
            className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]"
          />
        ) : null}
        <button
          type="button"
          disabled={readOnly}
          onClick={createShare}
          className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          <Share2 size={13} />
          Create sanitized share
        </button>
        {shareUrl ? (
          <input
            readOnly
            value={shareUrl}
            className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]"
          />
        ) : null}
      </div>
    </section>
  )
}
