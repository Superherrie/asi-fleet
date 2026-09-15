// Approve / return a travel log from the link in the manager's e-mail — no app login needed.
// GET  ?t=<token>            → small page showing the log with Approve / Return buttons
// GET  ?t=<token>&a=approve  → approves immediately (link in the mail)
// GET  ?t=<token>&a=return   → asks for a comment, then returns the log to the driver
// POST t, a, comment         → the same from the page's form
// Deployed with verify_jwt = false; the one-time token on the log is the authorisation. After deciding, queued mails are sent.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const html = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Calibri,Segoe UI,sans-serif;background:#f5f4f8;margin:0;padding:24px;color:#0e0b2e}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(14,11,46,.08)}
h1{font-size:20px;margin:0 0 4px}.sub{color:#64748b;font-size:13px;margin-bottom:16px}table{width:100%;font-size:14px;border-collapse:collapse}td{padding:4px 0}td:first-child{color:#64748b;width:45%}
.btn{display:inline-block;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;border:0;cursor:pointer;font-size:14px}.ok{background:#7b2fbe;color:#fff}.no{background:#fff;color:#b91c1c;border:1px solid #fca5a5}
textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:inherit}.foot{margin-top:18px;font-size:12px;color:#94a3b8}</style></head><body><div class="card">${body}<div class="foot">ASI Connect Fleet</div></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const month = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) }

Deno.serve(async (req) => {
  const url = new URL(req.url)
  let token = url.searchParams.get('t') ?? ''; let action = url.searchParams.get('a') ?? ''; let comment = ''
  if (req.method === 'POST') { const f = await req.formData(); token = String(f.get('t') ?? token); action = String(f.get('a') ?? action); comment = String(f.get('comment') ?? '') }
  if (!/^[0-9a-f-]{36}$/i.test(token)) return html('Invalid link', '<h1>Invalid link</h1><p>This approval link is incomplete.</p>', 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: rows } = await admin.rpc('fleet_log_by_token', { p_token: token })
  const log = rows?.[0]
  if (!log) return html('Link used', '<h1>This link has already been used</h1><p>The travel log has already been approved or returned. Nothing more to do.</p>')
  const summary = `<h1>Travel log — ${esc(log.employee_name)}</h1><div class="sub">${esc(month(log.period))} · vehicle ${esc(log.vehicle_reg || '—')}</div>
    <table><tr><td>Business km</td><td><b>${Number(log.business_km).toLocaleString('en-ZA')}</b></td></tr><tr><td>Private km</td><td>${Number(log.private_km).toLocaleString('en-ZA')}</td></tr>
    <tr><td>Business share</td><td>${log.business_km + log.private_km ? Math.round((100 * log.business_km) / (log.business_km + log.private_km)) : 0}%</td></tr></table>`

  if (action === 'approve' || (action === 'return' && (req.method === 'POST' || comment))) {
    const { data, error } = await admin.rpc('fleet_decide_log_by_token', { p_token: token, p_approve: action === 'approve', p_comment: comment || null })
    if (error) return html('Could not decide', `<h1>Could not ${action}</h1><p>${esc(error.message)}</p>`, 400)
    // send the driver's approved / returned mail (and anything else queued)
    try { await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fleet-notify`, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' }, body: '{}' }) } catch { /* mails stay queued */ }
    const d = data?.[0]
    return html(action === 'approve' ? 'Approved' : 'Returned', `<h1>${action === 'approve' ? '✓ Approved' : '↩ Returned to driver'}</h1><div class="sub">${esc(d?.employee_name)} · ${esc(month(d?.period ?? log.period))} · ${Number(d?.business_km ?? log.business_km).toLocaleString('en-ZA')} business km</div>
      <p>${action === 'approve' ? 'The claim has been created and will be paid with the next payroll. The driver has been notified.' : 'The driver has been asked to correct and resubmit the log.'}</p>`)
  }
  if (action === 'return') {
    return html('Return travel log', `${summary}<form method="post" style="margin-top:16px"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="a" value="return">
      <label style="font-size:13px;color:#64748b">Tell the driver what to correct</label><textarea name="comment" rows="3" required></textarea>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn no" type="submit">Return to driver</button><a class="btn" style="color:#64748b" href="?t=${esc(token)}">Back</a></div></form>`)
  }
  return html('Approve travel log', `${summary}<div style="margin-top:18px;display:flex;gap:8px"><a class="btn ok" href="?t=${esc(token)}&a=approve">Approve</a><a class="btn no" href="?t=${esc(token)}&a=return">Return to driver</a></div>`)
})
