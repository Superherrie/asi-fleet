// Sends pending fleet_notifications (travel-log approval e-mails) through Resend.
// Secrets: RESEND_API_KEY (required to actually send), NOTIFY_FROM (optional, default fleet@asiconnect.co.za).
// Invoked by the app after submit/decide, and safe to call any time (idempotent: only 'pending' rows are sent).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    // caller must be a signed-in fleet user (any role) — the function only ever sends queued mails
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: caller } = await admin.auth.getUser(jwt)
    if (!caller?.user) return json({ error: 'Not authenticated' }, 401)

    const key = Deno.env.get('RESEND_API_KEY')
    const { data: fromSetting } = await admin.from('fleet_settings').select('value').eq('key', 'notify_from').maybeSingle()
    const from = Deno.env.get('NOTIFY_FROM') || fromSetting?.value || 'fleet@asiconnect.co.za'

    const { data: pending } = await admin.from('fleet_notifications').select('*').eq('status', 'pending').order('created_at').limit(50)
    if (!pending?.length) return json({ sent: 0 })
    if (!key) return json({ sent: 0, pending: pending.length, error: 'RESEND_API_KEY not configured — mails stay queued' })

    let sent = 0
    for (const n of pending) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `ASI Fleet <${from}>`, to: [n.to_email], cc: n.cc_email ? [n.cc_email] : undefined, subject: n.subject,
          text: n.body, html: `<pre style="font-family:Calibri,Segoe UI,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(n.body)}</pre>`,
        }),
      })
      if (res.ok) { sent++; await admin.from('fleet_notifications').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', n.id) }
      else { const t = await res.text(); await admin.from('fleet_notifications').update({ status: 'failed', error: t.slice(0, 500) }).eq('id', n.id) }
    }
    return json({ sent, pending: pending.length - sent })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
}
