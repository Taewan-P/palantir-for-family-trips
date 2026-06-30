import { LogIn } from 'lucide-react'

export function LoginPage() {
  const apiBase = import.meta.env.VITE_API_BASE_URL || ''

  return (
    <main className="flex h-screen items-center justify-center bg-[#0d1117] text-[#C9D1D9]">
      <section className="w-[360px] border border-[#30363D] bg-[#161B22] p-6">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
          Family Ops
        </div>
        <h1 className="text-[18px] font-black uppercase tracking-[0.08em]">Sign in</h1>
        <a
          className="mt-6 flex items-center justify-center gap-2 border border-[#30363D] bg-[#0d1117] px-4 py-3 text-center text-[11px] font-black uppercase tracking-[0.14em] text-[#C9D1D9] transition-colors hover:border-[#58A6FF]"
          href={`${apiBase}/api/auth/google/start`}
        >
          <LogIn size={14} />
          Continue with Google
        </a>
      </section>
    </main>
  )
}
