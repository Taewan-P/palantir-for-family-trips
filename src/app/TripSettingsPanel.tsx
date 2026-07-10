import { useEffect, useState } from 'react'
import { Link, Share2, X } from 'lucide-react'

import { apiDelete, apiPost } from './api-client'

type InviteResponse = { inviteUrl: string }
type ShareResponse = { shareUrl: string }
type DisableShareResponse = { disabled: true }
type TripRole = 'owner' | 'editor'
type TripSettingsMember = {
  userId: string
  email: string
  name: string
  role: TripRole
}

export function TripSettingsPanel({
  tripId,
  title,
  role,
  members,
  readOnly,
  onRename,
}: {
  tripId: string
  title: string
  role: TripRole
  members: TripSettingsMember[]
  readOnly: boolean
  onRename: (title: string) => void
}) {
  const [titleDraft, setTitleDraft] = useState(title)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canEditTrip = !readOnly
  const canManageAccess = !readOnly && role === 'owner'

  useEffect(() => {
    setTitleDraft(title)
  }, [title])

  function renameTrip() {
    const nextTitle = titleDraft.trim()
    if (!canEditTrip || nextTitle === title) return
    if (!nextTitle) {
      setError('Trip title is required')
      return
    }
    setError(null)
    onRename(nextTitle)
  }

  async function createInvite() {
    if (!canManageAccess) return
    setError(null)
    const result = await apiPost<InviteResponse>(`/api/trips/${tripId}/invites`, { role: 'editor' })
    if (result.ok) setInviteUrl(result.data.inviteUrl)
    else setError(result.error.message)
  }

  async function createShare() {
    if (!canManageAccess) return
    setError(null)
    const result = await apiPost<ShareResponse>(`/api/trips/${tripId}/share-link`, {})
    if (result.ok) setShareUrl(result.data.shareUrl)
    else setError(result.error.message)
  }

  async function disableShare() {
    if (!canManageAccess) return
    setError(null)
    const result = await apiDelete<DisableShareResponse>(`/api/trips/${tripId}/share-link`)
    if (result.ok) setShareUrl(null)
    else setError(result.error.message)
  }

  function copyLink(url: string) {
    void navigator.clipboard?.writeText(url)
  }

  return (
    <section className="border border-[#30363D] bg-[#161B22] p-4">
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Trip metadata</div>
      {error ? <div className="mb-3 text-[11px] text-[#F85149]">{error}</div> : null}
      <div className="mb-4 grid gap-2">
        <input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          readOnly={!canEditTrip}
          className="border border-[#30363D] bg-[#0d1117] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
        />
        <button
          type="button"
          disabled={!canEditTrip || titleDraft.trim() === title}
          onClick={renameTrip}
          className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          Save title
        </button>
      </div>
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Members</div>
      <div className="mb-4 grid gap-2">
        {members.length ? members.map((member) => (
          <div key={member.userId} className="border border-[#30363D] bg-[#0d1117] px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">{member.name}</div>
            <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-[#8B949E]">
              <span className="truncate">{member.email}</span>
              <span className="uppercase">{member.role}</span>
            </div>
          </div>
        )) : (
          <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] text-[#8B949E]">Members loading</div>
        )}
      </div>
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Access</div>
      {!canManageAccess ? (
        <div className="mb-3 text-[11px] text-[#8B949E]">Owner access required</div>
      ) : null}
      <div className="grid gap-2">
        <button
          type="button"
          disabled={!canManageAccess}
          onClick={createInvite}
          className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          <Link size={13} />
          Create invite link
        </button>
        {inviteUrl ? (
          <div className="grid gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]"
            />
            <button
              type="button"
              onClick={() => copyLink(inviteUrl)}
              className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#C9D1D9]"
            >
              Copy invite
            </button>
          </div>
        ) : null}
        <button
          type="button"
          disabled={!canManageAccess}
          onClick={createShare}
          className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] disabled:opacity-40"
        >
          <Share2 size={13} />
          Create sanitized share
        </button>
        {shareUrl ? (
          <div className="grid gap-2">
            <input
              readOnly
              value={shareUrl}
              className="border border-[#30363D] bg-[#0d1117] px-2 py-2 font-mono text-[10px] text-[#C9D1D9]"
            />
            <button
              type="button"
              onClick={() => copyLink(shareUrl)}
              className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#C9D1D9]"
            >
              Copy share
            </button>
            <button
              type="button"
              disabled={!canManageAccess}
              onClick={disableShare}
              className="inline-flex items-center justify-center gap-2 border border-[#30363D] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#F85149] disabled:opacity-40"
            >
              <X size={13} />
              Disable share
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
