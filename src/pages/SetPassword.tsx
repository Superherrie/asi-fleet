import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Reached from the "choose your password" link an administrator e-mails: …/?th=<one-time token>#/set-password.
 *  The token is only used when the form is submitted, so a mail scanner that opens the link does not use it up. */
export default function SetPassword() {
  const th = new URLSearchParams(window.location.search).get('th') ?? ''
  const [pw1, setPw1] = useState(''); const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [verified, setVerified] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null)
    if (pw1.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw1 !== pw2) { setErr('The two passwords do not match.'); return }
    setBusy(true)
    if (!verified) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: th, type: 'recovery' })
      if (error) { setErr('This link has expired or has already been used. Ask the fleet administrator to send you a new one.'); setBusy(false); return }
      setVerified(true)
    }
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    if (error) { setErr(error.message); setBusy(false); return }
    // clear the "must change your password" flags (each RPC only touches the signed-in user; no profile = nothing to clear)
    await supabase.rpc('fleet_password_changed'); await supabase.rpc('budget_password_changed')
    window.location.replace(`${window.location.pathname}#/`)   // drops the token from the address and opens the app, signed in
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy p-4">
      <img src="brand/logo_white.png" alt="ASI Connect" className="absolute left-8 top-7 h-9" />
      <form onSubmit={(e) => void submit(e)} className="relative z-10 w-96 max-w-full rounded-xl bg-white p-8 shadow-2xl">
        <div className="brand-rule mb-4 w-12 rounded-full" />
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-pink">ASI Connect</p>
        <h1 className="mb-1 font-display text-xl font-bold text-brand-navy">Choose your password</h1>
        <p className="mb-6 text-sm text-slate-500">One login for ASI Fleet, ASI Budget and ASI Excellence.</p>
        {!th ? <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">This link is incomplete. Open the link from the e-mail again, or ask the fleet administrator for a new one.</p> : (
          <>
            <label className="mb-1 block text-sm font-medium">New password</label>
            <input type="password" required autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2" />
            <label className="mb-1 block text-sm font-medium">Confirm new password</label>
            <input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            <p className="mb-4 text-xs text-slate-400">At least 8 characters.</p>
            {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
            <button disabled={busy} className="w-full rounded-md bg-brand-purple py-2 font-medium text-white hover:bg-brand-lilac disabled:opacity-50">{busy ? 'Saving…' : 'Save password and sign in'}</button>
          </>
        )}
      </form>
    </div>
  )
}
