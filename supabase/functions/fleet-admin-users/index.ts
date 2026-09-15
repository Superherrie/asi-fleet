// One login for every ASI app. The three apps share this Supabase project's auth; each keeps its own access table:
//   ASI Excellence → public.profiles (app_role admin | appraiser | employee, job_role)
//   ASI Budget     → budget_profiles (is_admin) + budget_assignments (cost centre × compiler | approver)
//   ASI Fleet      → fleet_profiles (role admin | finance | payroll | manager | driver, employee_id)
// This function lets a Fleet admin create a user once and grant / revoke access per app. Caller must be fleet_profiles.is_admin.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const tempPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let s = 'Asi-'; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: caller } = await admin.auth.getUser(jwt)
    if (!caller?.user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await admin.from('fleet_profiles').select('is_admin').eq('user_id', caller.user.id).maybeSingle()
    if (!prof?.is_admin) return json({ error: 'Admin access required' }, 403)

    const body = await req.json()
    const findUser = async (email: string) => { const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); return data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()) ?? null }

    // ---- grants per app (null / disabled = revoke)
    async function setExcellence(user_id: string, email: string, name: string, app_role: string | null, job_role: string | null) {
      if (!app_role) { await admin.from('profiles').delete().eq('id', user_id); return }
      const { error } = await admin.from('profiles').upsert({ id: user_id, email, name: name || email, app_role, job_role: job_role || null }, { onConflict: 'id' }); if (error) throw error
      await admin.from('pending_invites').delete().ilike('email', email)
    }
    async function setBudget(user_id: string, email: string, name: string, enabled: boolean, is_admin: boolean, assignments: { cost_centre_id: number; role: string }[] | undefined) {
      if (!enabled) { await admin.from('budget_profiles').delete().eq('user_id', user_id); return }
      const { data: ex } = await admin.from('budget_profiles').select('user_id').eq('user_id', user_id).maybeSingle()
      const { error } = await admin.from('budget_profiles').upsert({ user_id, email, full_name: name || email, is_admin: !!is_admin, ...(ex ? {} : { must_change_password: true }) }, { onConflict: 'user_id' }); if (error) throw error
      if (assignments) { await admin.from('budget_assignments').delete().eq('user_id', user_id); if (assignments.length) { const { error: aErr } = await admin.from('budget_assignments').insert(assignments.map((a) => ({ user_id, cost_centre_id: a.cost_centre_id, role: a.role }))); if (aErr) throw aErr } }
    }
    async function setFleet(user_id: string, email: string, name: string, role: string | null, employee_id: number | null | undefined) {
      if (!role) { if (user_id === caller!.user.id) throw new Error('You cannot remove your own Fleet access'); await admin.from('fleet_profiles').delete().eq('user_id', user_id); return }
      const { data: ex } = await admin.from('fleet_profiles').select('user_id,employee_id').eq('user_id', user_id).maybeSingle()
      let emp = employee_id === undefined ? ex?.employee_id ?? null : employee_id
      if (emp == null) { const { data: e } = await admin.from('fleet_employees').select('id').ilike('email', email).maybeSingle(); emp = e?.id ?? null }   // link the card holder by e-mail
      const { error } = await admin.from('fleet_profiles').upsert({ user_id, email, full_name: name || email, role, is_admin: role === 'admin', employee_id: emp, ...(ex ? {} : { must_change_password: true }) }, { onConflict: 'user_id' }); if (error) throw error
    }

    switch (body.action) {
      case 'list': {
        const [{ data: users }, ex, bu, ba, cc, fl] = await Promise.all([
          admin.auth.admin.listUsers({ perPage: 1000 }), admin.from('profiles').select('id,email,name,app_role,job_role'), admin.from('budget_profiles').select('user_id,email,full_name,is_admin,must_change_password'),
          admin.from('budget_assignments').select('user_id,cost_centre_id,role'), admin.from('budget_cost_centres').select('id,code,name,active').order('code'), admin.from('fleet_profiles').select('user_id,email,full_name,role,is_admin,employee_id,must_change_password'),
        ])
        return json({ users: users.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })), excellence: ex.data ?? [], budget: bu.data ?? [], assignments: ba.data ?? [], cost_centres: cc.data ?? [], fleet: fl.data ?? [] })
      }
      case 'create': {
        const { email, full_name, password, fleet_role, employee_id, budget, budget_admin, excellence_role, job_role } = body
        if (!email) return json({ error: 'E-mail is required' }, 400)
        let user = await findUser(email); let temp: string | null = null; let created = false
        if (!user) { temp = password || tempPassword(); const { data, error } = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true }); if (error) return json({ error: error.message }, 400); user = data.user; created = true }
        else if (password) { await admin.auth.admin.updateUserById(user.id, { password }); temp = password }
        if (fleet_role) await setFleet(user.id, email, full_name, fleet_role, employee_id ?? undefined)
        if (budget) await setBudget(user.id, email, full_name, true, !!budget_admin, undefined)
        if (excellence_role) await setExcellence(user.id, email, full_name, excellence_role, job_role ?? null)
        return json({ user_id: user.id, created, temp_password: temp })
      }
      case 'set_excellence': { const { user_id, email, name, app_role, job_role } = body; await setExcellence(user_id, email, name, app_role || null, job_role || null); return json({ ok: true }) }
      case 'set_budget': { const { user_id, email, name, enabled, is_admin, assignments } = body; await setBudget(user_id, email, name, !!enabled, !!is_admin, assignments); return json({ ok: true }) }
      case 'set_fleet': { const { user_id, email, name, role, employee_id } = body; await setFleet(user_id, email, name, role || null, employee_id); return json({ ok: true }) }
      case 'reset_password': {
        const { user_id, password } = body; const pw = password || tempPassword()
        const { error } = await admin.auth.admin.updateUserById(user_id, { password: pw }); if (error) return json({ error: error.message }, 400)
        await admin.from('fleet_profiles').update({ must_change_password: true }).eq('user_id', user_id); await admin.from('budget_profiles').update({ must_change_password: true }).eq('user_id', user_id)
        return json({ ok: true, temp_password: pw })
      }
      case 'set_admin': { const { user_id, is_admin } = body; const { error } = await admin.from('fleet_profiles').update({ is_admin: !!is_admin }).eq('user_id', user_id); return error ? json({ error: error.message }, 400) : json({ ok: true }) }
      case 'delete': {
        const { user_id } = body; if (user_id === caller.user.id) return json({ error: 'You cannot delete your own account' }, 400)
        const { error } = await admin.auth.admin.deleteUser(user_id); return error ? json({ error: error.message }, 400) : json({ ok: true })   // cascades to all three apps
      }
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500) }
})
