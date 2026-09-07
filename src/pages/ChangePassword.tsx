import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/** Set a new password. `forced` is used on first login, when the user's
 *  password was set for them and they cannot continue until they change it. */
export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { profile, refresh, signOut } = useAuth()
  const navigate = useNavigate()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setErr(null)
    if (pw1.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw1 !== pw2) { setErr('The two passwords do not match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    if (error) { setErr(error.message); setBusy(false); return }
    // clear the "must change" flag (security-definer RPC — only touches this user)
    const { error: rpcErr } = await supabase.rpc('fleet_password_changed')
    if (rpcErr) { setErr(rpcErr.message); setBusy(false); return }
    await refresh()
    setBusy(false)
    setDone(true)
    if (!forced) setTimeout(() => navigate('/'), 1200)
  }

  return (
    <div className={forced ? 'mx-auto max-w-md pt-10' : 'mx-auto max-w-md'}>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-sky-950">
          {forced ? 'Choose a new password' : 'Change password'}
        </h1>
        <p className="mb-4 text-sm text-slate-500">
          {forced
            ? `Your password was set for you. Please choose your own before continuing.`
            : 'Set a new password for your account.'}
        </p>

        {done ? (
          <div>
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Password updated{forced ? '' : ' — returning to your cost centres…'}
            </p>
            {forced && (
              <button
                onClick={() => navigate('/')}
                className="mt-3 w-full rounded-md bg-sky-800 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Continue
              </button>
            )}
          </div>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-500">New password</label>
            <input
              type="password" value={pw1} autoFocus
              onChange={(e) => setPw1(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
            <label className="block text-xs font-medium text-slate-500">Confirm new password</label>
            <input
              type="password" value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="mb-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
            <p className="mb-3 text-xs text-slate-400">At least 8 characters.</p>
            {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="w-full rounded-md bg-sky-800 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <div className="mt-3 flex justify-between text-xs text-slate-400">
              <span>{profile?.email}</span>
              {forced
                ? <button onClick={() => void signOut()} className="hover:text-slate-600">Sign out</button>
                : <button onClick={() => navigate('/')} className="hover:text-slate-600">Cancel</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
