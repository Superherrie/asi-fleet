// Admin user management: create users, reset passwords, toggle admin.
// Caller must be an authenticated user with fleet_profiles.is_admin = true.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // identify caller and verify admin
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: caller } = await admin.auth.getUser(jwt)
    if (!caller?.user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await admin
      .from('fleet_profiles')
      .select('is_admin')
      .eq('user_id', caller.user.id)
      .maybeSingle()
    if (!prof?.is_admin) return json({ error: 'Admin access required' }, 403)

    const body = await req.json()
    switch (body.action) {
      case 'create': {
        const { email, password, full_name, is_admin, role, employee_id } = body
        if (!email || !password) return json({ error: 'email and password are required' }, 400)
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
        if (error) return json({ error: error.message }, 400)
        const { error: pErr } = await admin.from('fleet_profiles').upsert({
          user_id: data.user.id,
          email,
          full_name: full_name ?? '',
          is_admin: !!is_admin || role === 'admin', role: role ?? 'driver', employee_id: employee_id ?? null, must_change_password: true,
        })
        if (pErr) return json({ error: pErr.message }, 400)
        return json({ user_id: data.user.id })
      }
      case 'reset_password': {
        const { user_id, password } = body
        if (!user_id || !password) return json({ error: 'user_id and password are required' }, 400)
        const { error } = await admin.auth.admin.updateUserById(user_id, { password })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case 'set_admin': {
        const { user_id, is_admin } = body
        const { error } = await admin.from('fleet_profiles').update({ is_admin: !!is_admin }).eq('user_id', user_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case 'delete': {
        const { user_id } = body
        if (user_id === caller.user.id) return json({ error: 'You cannot delete your own account' }, 400)
        const { error } = await admin.auth.admin.deleteUser(user_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
