const fs = require('fs');
const rep = (f, pairs) => { let s = fs.readFileSync(f, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`MISSING in ${f}: ${a.slice(0, 110)}`); s = s.split(a).join(b); } fs.writeFileSync(f, s); console.log(f, 'ok', pairs.length); };

// Layout: pending-approval badge on the Approvals link, so managers see work waiting without an e-mail
rep('src/components/Layout.tsx', [
  ["import { NavLink, Outlet, Navigate } from 'react-router-dom'", "import { NavLink, Outlet, Navigate } from 'react-router-dom'\nimport { useEffect, useState } from 'react'\nimport { supabase } from '../lib/supabase'"],
  ["  if (loading) return <div className=\"flex h-screen items-center justify-center text-slate-500\">Loading…</div>",
   "  const [pending, setPending] = useState(0)\n  useEffect(() => {\n    if (!session || !isManager) return\n    const refresh = () => { void supabase.from('fleet_travel_logs').select('id', { count: 'exact', head: true }).eq('status', 'submitted').then(({ count }) => setPending(count ?? 0)) }   // RLS limits this to the logs this manager may approve\n    refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t)\n  }, [session, isManager])\n  if (loading) return <div className=\"flex h-screen items-center justify-center text-slate-500\">Loading…</div>"],
  ["            {isManager && <NavLink to=\"/approvals\" className={linkClass}>Approvals</NavLink>}",
   "            {isManager && <NavLink to=\"/approvals\" className={linkClass}>Approvals{pending > 0 && <span className=\"ml-1 rounded-full bg-brand-pink px-1.5 text-xs font-semibold text-white\">{pending}</span>}</NavLink>}"],
]);

// LogEditor: tell the driver what happens next (no e-mail); only call the mailer when mail is switched on
rep('src/pages/driver/LogEditor.tsx', [
  ["    const { error } = await supabase.rpc('fleet_submit_log', { p_log: log.id })\n    setBusy(false)\n    if (error) { setMsg({ tone: 'red', text: error.message }); return }\n    void supabase.functions.invoke('fleet-notify').catch(() => {})\n    nav('/my-logs')",
   "    const { error } = await supabase.rpc('fleet_submit_log', { p_log: log.id })\n    setBusy(false)\n    if (error) { setMsg({ tone: 'red', text: error.message }); return }\n    if (mailOn) void supabase.functions.invoke('fleet-notify').catch(() => {})\n    nav('/my-logs', { state: { flash: mailOn ? 'Submitted — your manager has been e-mailed.' : `Submitted. ${log.manager_email ? log.manager_email.split('@')[0].replace('.', ' ') : 'Your manager'} will see it under Approvals the next time they sign in; e-mail notifications are switched off for now.` } })"],
  ["    if (error) { setMsg({ tone: 'red', text: error.message }); return }\n    void supabase.functions.invoke('fleet-notify').catch(() => {})\n    nav(readOnly ? '/approvals' : '/my-logs')",
   "    if (error) { setMsg({ tone: 'red', text: error.message }); return }\n    if (mailOn) void supabase.functions.invoke('fleet-notify').catch(() => {})\n    nav(readOnly ? '/approvals' : '/my-logs')"],
  ["  const [openingHint, setOpeningHint] = useState<string | null>(null)", "  const [openingHint, setOpeningHint] = useState<string | null>(null)\n  const [mailOn, setMailOn] = useState(false)\n  useEffect(() => { void supabase.from('fleet_settings').select('value').eq('key', 'notifications_enabled').maybeSingle().then(({ data }) => setMailOn(data?.value === 'true')) }, [])"],
]);

// Travellers: when mail is off, say so instead of nagging about the queue, and hide the remind buttons
rep('src/pages/admin/Travellers.tsx', [
  ["  const stuck = notifs.filter((n) => n.status === 'pending').length; const failed = notifs.filter((n) => n.status === 'failed').length",
   "  const mailOn = m.setting('notifications_enabled') === 'true'\n  const stuck = mailOn ? notifs.filter((n) => n.status === 'pending').length : 0; const failed = mailOn ? notifs.filter((n) => n.status === 'failed').length : 0"],
  ["            <Stat label=\"E-mails queued\" value={stuck} sub={failed ? `${failed} failed` : 'waiting to be sent'} tone={stuck ? 'pink' : undefined} />",
   "            {mailOn ? <Stat label=\"E-mails queued\" value={stuck} sub={failed ? `${failed} failed` : 'waiting to be sent'} tone={stuck ? 'pink' : undefined} /> : <Stat label=\"E-mail\" value=\"off\" sub=\"managers approve under Approvals; switch on under Admin → Settings\" />}"],
  ["            <Button variant=\"secondary\" size=\"sm\" disabled={busy !== null || !shown.some((r) => r.state === 'not received' && r.e.email)} onClick={() => void remindAll()} className=\"ml-auto\">",
   "            {mailOn && <Button variant=\"secondary\" size=\"sm\" disabled={busy !== null || !shown.some((r) => r.state === 'not received' && r.e.email)} onClick={() => void remindAll()} className=\"ml-auto\">"],
  ["Remind all not received{state !== 'all' || branch !== '' || q ? ' (filtered)' : ''}</Button>", "Remind all not received{state !== 'all' || branch !== '' || q ? ' (filtered)' : ''}</Button>}"],
  ["                      {r.state === 'not received' && r.e.email && <button type=\"button\"", "                      {mailOn && r.state === 'not received' && r.e.email && <button type=\"button\""],
  ["                <Table head={['Emp', 'Traveller', 'Branch', 'Manager', 'Log', 'Business km', 'Submitted', 'Decided', 'Claim', 'Claim status', 'Last e-mail', '']}>",
   "                <Table head={['Emp', 'Traveller', 'Branch', 'Manager', 'Log', 'Business km', 'Submitted', 'Decided', 'Claim', 'Claim status', mailOn ? 'Last e-mail' : 'Login', '']}>"],
  ["                    <Td>{mailBadge(r)}</Td>", "                    <Td>{mailOn ? mailBadge(r) : (r.e.email && logins.has(r.e.email.toLowerCase()) ? <Badge tone=\"teal\">yes</Badge> : <Badge tone=\"amber\">no login</Badge>)}</Td>"],
  ["  const [logs, setLogs] = useState<TravelLog[]>([]); const [claims, setClaims] = useState<Claim[]>([]); const [notifs, setNotifs] = useState<Notif[]>([])",
   "  const [logs, setLogs] = useState<TravelLog[]>([]); const [claims, setClaims] = useState<Claim[]>([]); const [notifs, setNotifs] = useState<Notif[]>([]); const [logins, setLogins] = useState<Set<string>>(new Set())"],
  ["    setLogs((l.data ?? []) as TravelLog[]); setClaims((c.data ?? []) as Claim[]); setNotifs((n.data ?? []) as Notif[]); setLoading(false)",
   "    const { data: fp } = await supabase.from('fleet_profiles').select('email')\n    setLogins(new Set((fp ?? []).map((p: { email: string }) => p.email.toLowerCase())))\n    setLogs((l.data ?? []) as TravelLog[]); setClaims((c.data ?? []) as Claim[]); setNotifs((n.data ?? []) as Notif[]); setLoading(false)"],
]);
console.log('done');
