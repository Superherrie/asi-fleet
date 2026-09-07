import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Employee, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  employee: Employee | null
  isAdmin: boolean
  /** manages at least one employee (or is admin) */
  isManager: boolean
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null, profile: null, employee: null, isAdmin: false, isManager: false, loading: true,
  refresh: async () => {}, signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [isManager, setIsManager] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load(s: Session | null) {
    if (!s) { setProfile(null); setEmployee(null); setIsManager(false); return }
    const { data: p } = await supabase.from('fleet_profiles').select('*').eq('user_id', s.user.id).maybeSingle()
    const prof = (p as Profile) ?? null
    setProfile(prof)
    let emp: Employee | null = null
    if (prof?.employee_id) {
      const { data: e } = await supabase.from('fleet_employees').select('*').eq('id', prof.employee_id).maybeSingle()
      emp = (e as Employee) ?? null
    }
    setEmployee(emp)
    const email = (prof?.email ?? s.user.email ?? '').toLowerCase()
    const q = supabase.from('fleet_employees').select('id', { count: 'exact', head: true }).eq('active', true)
    const { count } = emp
      ? await q.or(`manager_employee_id.eq.${emp.id},manager_email.ilike.${email}`)
      : await q.ilike('manager_email', email)
    setIsManager(!!prof?.is_admin || prof?.role === 'manager' || (count ?? 0) > 0)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await load(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void load(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  const isAdmin = !!profile && (profile.is_admin || ['admin', 'finance', 'payroll'].includes(profile.role))
  return (
    <AuthContext.Provider value={{ session, profile, employee, isAdmin, isManager, loading, refresh: () => load(session), signOut: async () => { await supabase.auth.signOut() } }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useContext(AuthContext) }
