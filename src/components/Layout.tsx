import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ChangePassword from '../pages/ChangePassword'
import ErrorBoundary from './ErrorBoundary'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap ${isActive ? 'bg-sky-900 text-white' : 'text-sky-100 hover:bg-sky-800'}`

export default function Layout() {
  const { session, profile, employee, isAdmin, isManager, hasBranches, loading, signOut } = useAuth()
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (!session || !isManager) return
    const refresh = () => { void supabase.from('fleet_travel_logs').select('id', { count: 'exact', head: true }).eq('status', 'submitted').then(({ count }) => setPending(count ?? 0)) }   // RLS limits this to the logs this manager may approve
    refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t)
  }, [session, isManager])
  if (loading) return <div className="flex h-screen items-center justify-center text-slate-500">Loading…</div>
  if (!session) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-navy text-white">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-2">
          <img src="brand/logo_white.png" alt="ASI Connect" className="h-7" />
          <span className="font-display text-sm font-semibold tracking-tight text-white/70">Fleet</span>
          <nav className="flex gap-1 overflow-x-auto">
            {isAdmin && <NavLink to="/" end className={linkClass}>Dashboard</NavLink>}
            {(employee || isAdmin) && <NavLink to="/my-logs" className={linkClass}>My Travel Logs</NavLink>}
            {isManager && <NavLink to="/approvals" className={linkClass}>Approvals{pending > 0 && <span className="ml-1 rounded-full bg-brand-pink px-1.5 text-xs font-semibold text-white">{pending}</span>}</NavLink>}
            {hasBranches && !isAdmin && <NavLink to="/branch" className={linkClass}>My branch vehicles</NavLink>}
            {isAdmin && <NavLink to="/travellers" className={linkClass}>Travellers</NavLink>}
            {isAdmin && (
              <>
                <NavLink to="/imports" className={linkClass}>Imports</NavLink>
                <NavLink to="/journals" className={linkClass}>Journals</NavLink>
                <NavLink to="/recon" className={linkClass}>Recon</NavLink>
                <NavLink to="/payroll" className={linkClass}>Payroll</NavLink>
                <NavLink to="/fleet" className={linkClass}>Fleet</NavLink>
                <NavLink to="/admin" className={linkClass}>Admin</NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-sky-200">
            <span className="hidden sm:inline">{profile?.full_name || session.user.email}</span>
            {!profile?.must_change_password && (
              <NavLink to="/change-password" className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-800">Password</NavLink>
            )}
            <button onClick={() => void signOut()} className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-800">Sign out</button>
          </div>
        </div>
        <div className="brand-rule" />
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-4">
        {profile?.must_change_password ? <ChangePassword forced /> : profile ? <ErrorBoundary><Outlet /></ErrorBoundary> : (
          <div className="mx-auto mt-16 max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Your login exists but has no Fleet profile yet. Ask the fleet administrator to add you under Admin → Users.
          </div>
        )}
      </main>
      <footer className="bg-brand-navy text-white">
        <div className="brand-rule" />
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">Connecting business to purpose</p>
          <span className="text-[10px] tracking-[0.2em] text-white/40">asiconnect.co.za</span>
        </div>
      </footer>
    </div>
  )
}
