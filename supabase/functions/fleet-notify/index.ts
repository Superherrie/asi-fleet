// Sends the fleet app's e-mail through Microsoft 365 (Graph sendMail from a shared mailbox).
// Secrets on the Supabase project: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET — an Entra app registration with the Graph
// application permission Mail.Send, restricted to the sending mailbox. The mailbox is fleet_settings.notify_from (or NOTIFY_FROM).
//   (no action)       any signed-in fleet user, or the service role: send the queued fleet_notifications ('pending').
//                     Only while notifications_enabled = true; safe to call any time (only 'pending' rows are sent).
//   action 'status'   any signed-in user: { configured, enabled, from }
//   action 'test'     fleet admin: one test mail to the caller's own address, whether or not notifications are switched on
//   action 'direct'   service role only (the other edge functions): send { to, subject, body } now; nothing is stored
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const NOT_SET = 'E-mail is not set up yet: the Microsoft 365 keys (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET) are not on the server.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const isService = !!jwt && jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')   // called by fleet-approve / fleet-admin-users
    const { data: caller } = isService ? { data: null } : await admin.auth.getUser(jwt)
    if (!isService && !caller?.user) return json({ error: 'Not authenticated' }, 401)
    let body: Record<string, unknown> = {}; try { body = await req.json() } catch { /* called without a body */ }
    const action = String(body.action ?? '')

    const { data: st } = await admin.from('fleet_settings').select('key,value').in('key', ['notify_from', 'notifications_enabled'])
    const setting = (k: string) => st?.find((s) => s.key === k)?.value as string | undefined
    const from = Deno.env.get('NOTIFY_FROM') || setting('notify_from') || 'fleet@asiconnect.co.za'
    const enabled = setting('notifications_enabled') === 'true'
    const configured = !!(Deno.env.get('MS_TENANT_ID') && Deno.env.get('MS_CLIENT_ID') && Deno.env.get('MS_CLIENT_SECRET'))

    if (action === 'status') return json({ configured, enabled, from })

    if (action === 'test') {
      if (isService || !caller?.user?.email) return json({ error: 'Sign in to send a test mail' }, 400)
      const { data: prof } = await admin.from('fleet_profiles').select('is_admin').eq('user_id', caller.user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admin access required' }, 403)
      if (!configured) return json({ error: NOT_SET })
      const tk = await graphToken(); if ('error' in tk) return json({ error: tk.error })
      const err = await send(tk.token, from, { to: caller.user.email, subject: 'ASI Fleet test e-mail', text: `This is a test from the ASI Fleet app, sent from ${from}.\n\nIf you can read this, the app can send e-mail.` })
      return json(err ? { error: err } : { ok: true, to: caller.user.email, from })
    }

    if (action === 'direct') {
      if (!isService) return json({ error: 'Not allowed' }, 403)
      const to = String(body.to ?? ''); const subject = String(body.subject ?? ''); const text = String(body.body ?? '')
      if (!to || !subject || !text) return json({ error: 'to, subject and body are required' }, 400)
      if (!configured) return json({ error: NOT_SET })
      const tk = await graphToken(); if ('error' in tk) return json({ error: tk.error })
      const err = await send(tk.token, from, { to, subject, text })
      return json(err ? { error: err } : { ok: true })
    }

    // the queue
    if (!enabled) return json({ sent: 0, disabled: true })
    const { data: pending } = await admin.from('fleet_notifications').select('*').eq('status', 'pending').order('created_at').limit(50)
    if (!pending?.length) return json({ sent: 0 })
    if (!configured) return json({ sent: 0, pending: pending.length, error: `${NOT_SET} Mails stay queued.` })
    const tk = await graphToken(); if ('error' in tk) return json({ sent: 0, pending: pending.length, error: tk.error })

    let sent = 0
    for (const n of pending) {
      const err = await send(tk.token, from, { to: n.to_email, cc: n.cc_email, subject: n.subject, text: n.body })
      if (!err) { sent++; await admin.from('fleet_notifications').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', n.id) }
      else await admin.from('fleet_notifications').update({ status: 'failed', error: err.slice(0, 500) }).eq('id', n.id)
    }
    return json({ sent, pending: pending.length - sent })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

/** App-only sign-in to Microsoft Graph (client credentials). */
async function graphToken(): Promise<{ token: string } | { error: string }> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${Deno.env.get('MS_TENANT_ID')}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: Deno.env.get('MS_CLIENT_ID')!, client_secret: Deno.env.get('MS_CLIENT_SECRET')!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.access_token) return { error: `Microsoft 365 sign-in failed: ${String(j.error_description ?? j.error ?? res.status).slice(0, 300)}` }
    return { token: j.access_token as string }
  } catch (e) { return { error: `Microsoft 365 sign-in failed: ${(e as Error).message}` } }
}

/** Sends one mail from the shared mailbox. Returns null when Microsoft accepted it, otherwise the reason. */
async function send(token: string, from: string, m: { to: string; cc?: string | null; subject: string; text: string }): Promise<string | null> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: `<div style="font-family:Calibri,Segoe UI,sans-serif;font-size:11pt">${toHtml(m.text)}</div>` },
        toRecipients: [{ emailAddress: { address: m.to } }],
        ...(m.cc ? { ccRecipients: [{ emailAddress: { address: m.cc } }] } : {}),
      },
      saveToSentItems: true,
    }),
  })
  if (res.status === 202) return null
  return `Microsoft 365 refused the mail (${res.status}): ${(await res.text()).slice(0, 400)}`
}

function toHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, '<br>')
}
