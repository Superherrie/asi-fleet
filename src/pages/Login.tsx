import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy">
      {/* brand motifs — reserved for this "title" moment, bleeding off-canvas */}
      <img src="brand/spiral.png" alt="" aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 w-[28rem] max-w-none opacity-80" />
      <img src="brand/wave.png" alt="" aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 w-[26rem] max-w-none opacity-80" />
      <div className="pointer-events-none absolute right-28 top-24 h-24 w-24 rounded-full border border-brand-lilac/60" />

      <img src="brand/logo_white.png" alt="ASI Connect" className="absolute left-8 top-7 h-9" />
      <p className="absolute right-8 top-9 hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 sm:block">
        Connecting business to purpose
      </p>
      <span className="pointer-events-none absolute left-3 top-1/2 hidden -translate-y-1/2 -rotate-90 text-[10px] tracking-[0.2em] text-white/40 lg:block">
        asiconnect.co.za
      </span>

      <form onSubmit={onSubmit} className="relative z-10 w-96 rounded-xl bg-white p-8 shadow-2xl">
        <div className="brand-rule mb-4 w-12 rounded-full" />
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-pink">ASI Connect</p>
        <h1 className="mb-1 font-display text-xl font-bold text-brand-navy">Fleet</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with your ASI Connect fleet account</p>
        {!supabaseConfigured && (
          <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        )}
        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2"
        />
        <label className="mb-1 block text-sm font-medium">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2"
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-brand-purple py-2 font-medium text-white hover:bg-brand-lilac disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
