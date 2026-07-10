import { LogIn } from 'lucide-react'

export function authStartHref(
  apiBase: string | undefined,
  _isDev: boolean,
  _hostname = globalThis.location?.hostname,
  nextPath?: string,
): string {
  const base = apiBase || ''
  const href = `${base}/api/auth/google/start`
  return nextPath ? `${href}?next=${encodeURIComponent(nextPath)}` : href
}

export function loginRoute(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`
}

function loginNextPath(): string | undefined {
  const nextPath = new URLSearchParams(globalThis.location?.search).get('next')
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//') || nextPath.includes('\\')) {
    return undefined
  }
  return nextPath
}

export function LoginPage() {
  return (
    <main className="flex h-screen items-center justify-center bg-[#0d1117] text-[#C9D1D9]">
      <section className="w-[360px] border border-[#30363D] bg-[#161B22] p-6">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
          Family Ops
        </div>
        <h1 className="text-[18px] font-black uppercase tracking-[0.08em]">Sign in</h1>
        <a
          className="mt-6 flex items-center justify-center gap-2 border border-[#30363D] bg-[#0d1117] px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.14em] text-[#C9D1D9] transition-colors hover:border-[#58A6FF]"
          href={authStartHref(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV, undefined, loginNextPath())}
        >
          <LogIn size={14} />
          Continue with Google
        </a>
      </section>
    </main>
  )
}
