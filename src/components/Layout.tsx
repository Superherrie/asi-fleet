import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ChangePassword from '../pages/ChangePassword'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap ${isActive ? 'bg-sky-900 text-white' : 'text-sky-100 hover:bg-sky-800'}`

export default function Layout() {
  const { session, profile, employee, isAdmin, isManager, loading, signOut } = useAuth()
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
            {isManager && <NavLink to="/approvals" className={linkClass}>Approvals</NavLink>}
            {isAdmin && (
              <>
                <NavLink to="/imports" className={linkClass}>Imports</NavLink>
                <NavLink to="/journals" className={linkClass}>Journals</NavLink>
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
        {profile?.must_change_password ? <ChangePassword forced /> : profile ? <Outlet /> : (
          <div className="mx-auto mt-16 max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Your login exists but has no Fleet profile yet. Ask the fleet administrator to add you under Admin → Users.
          </div>
        )}
      </main>
    </div>
  )
}
