import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters, type Masters } from '../../hooks/useMasters'
import { CATEGORIES, type ClaimRate, type GlMap, type Notification } from '../../lib/types'
import { fmtDate } from '../../lib/format'
import { Page, Card, Button, Table, Td, Alert, Badge, statusTone, Input, Select, Spinner, Empty, Field } from '../../components/ui'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-brand-lilac focus:bg-white focus:outline-none'

export default function Admin() {
  const m = useMasters()
  return (
    <Page title="Admin" subtitle="Claim rates, GL mapping, contra accounts, users and e-mail notifications.">
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-brand-hairline pb-2"><NavLink to="/admin/rates" className={tab}>Claim rates</NavLink><NavLink to="/admin/gl" className={tab}>GL map</NavLink><NavLink to="/admin/settings" className={tab}>Settings</NavLink><NavLink to="/admin/users" className={tab}>Users &amp; access</NavLink><NavLink to="/admin/notifications" className={tab}>E-mail queue</NavLink></nav>
      {m.loading ? <Spinner /> : (
        <Routes>
          <Route index element={<Navigate to="rates" replace />} />
          <Route path="rates" element={<Rates m={m} />} />
          <Route path="gl" element={<Gl m={m} />} />
          <Route path="settings" element={<Settings m={m} />} />
          <Route path="users" element={<Users m={m} />} />
          <Route path="notifications" element={<Notifications />} />
        </Routes>
      )}
    </Page>
  )
}

function Rates({ m }: { m: Masters }) {
  const [msg, setMsg] = useState<string | null>(null); const [eff, setEff] = useState(new Date().toISOString().slice(0, 8) + '01')
  async function save(r: ClaimRate, patch: Partial<ClaimRate>) { const { error } = await supabase.from('fleet_claim_rates').update(patch).eq('id', r.id); if (error) setMsg(error.message); else await m.reload() }
  async function addSet() {
    const latest = (c: string) => [...m.rates].reverse().find((r) => r.category === c)
    const { error } = await supabase.from('fleet_claim_rates').upsert(CATEGORIES.map((c) => ({ category: c, effective_from: eff, fuel_rate: latest(c)?.fuel_rate ?? 0, maint_rate: latest(c)?.maint_rate ?? 0 })), { onConflict: 'category,effective_from' })
    if (error) setMsg(error.message); else await m.reload()
  }
  async function del(r: ClaimRate) { if (!confirm('Delete this rate row?')) return; await supabase.from('fleet_claim_rates').delete().eq('id', r.id); await m.reload() }
  return (
    <div className="space-y-3">
      <Alert tone="blue">Reimbursement per business km, per staff category. The <b>fuel</b> portion is paid out with the next salary; the <b>maintenance</b> portion accrues per person. The rate in force on the 1st of the log month is used when a manager approves a log.</Alert>
      {msg && <Alert tone="red">{msg}</Alert>}
      <Card title="Rates" actions={<div className="flex items-center gap-2 text-sm">New rate set effective <Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /><Button size="sm" onClick={() => void addSet()}>Add</Button></div>}>
        <Table head={['Category', 'Effective from', 'Fuel R/km', 'Maintenance R/km', 'Total R/km', '']}>
          {m.rates.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium">{r.category}</Td><Td>{fmtDate(r.effective_from)}</Td>
              <Td><input type="number" step="0.01" className={`${cell} w-24 text-right`} defaultValue={r.fuel_rate} onBlur={(e) => Number(e.target.value) !== r.fuel_rate && save(r, { fuel_rate: Number(e.target.value) })} /></Td>
              <Td><input type="number" step="0.01" className={`${cell} w-24 text-right`} defaultValue={r.maint_rate} onBlur={(e) => Number(e.target.value) !== r.maint_rate && save(r, { maint_rate: Number(e.target.value) })} /></Td>
              <Td num>{(Number(r.fuel_rate) + Number(r.maint_rate)).toFixed(2)}</Td>
              <Td><button onClick={() => void del(r)} className="text-xs text-slate-400 hover:text-red-600">delete</button></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

function Gl({ m }: { m: Masters }) {
  const [msg, setMsg] = useState<string | null>(null)
  async function save(g: GlMap, patch: Partial<GlMap>) { const { error } = await supabase.from('fleet_gl_map').update(patch).eq('id', g.id); if (error) setMsg(error.message); else await m.reload() }
  const sources = [...new Set(m.glmap.map((g) => g.source))]
  const [src, setSrc] = useState(sources[0] ?? 'first_auto')
  const rows = m.glmap.filter((g) => g.source === src).sort((a, b) => a.cost_type.localeCompare(b.cost_type) || CATEGORIES.indexOf(a.category ?? 'Admin') - CATEGORIES.indexOf(b.category ?? 'Admin'))
  return (
    <div className="space-y-3">
      <Alert tone="blue">Expense account per source, cost type and staff category. Defaults follow the budget chart: 215x00 Fuel/Oil, 216x00 Maintenance, 217x00 Surveillance, 218x00 Lease/Rental, 219x00 Toll (x = 0 Admin, 1 Ops Cabling, 2 Ops Admin, 3 Sales, 4 Exec). Insurance defaults to 415500 — confirm with the management accountant.</Alert>
      {msg && <Alert tone="red">{msg}</Alert>}
      <div className="flex gap-1">{sources.map((s) => <Button key={s} size="sm" variant={s === src ? 'primary' : 'secondary'} onClick={() => setSrc(s)}>{s}</Button>)}</div>
      <Card>
        <Table head={['Cost type', 'Category', 'GL account', 'GL name']}>
          {rows.map((g) => (
            <tr key={g.id}><Td className="font-medium">{g.cost_type}</Td><Td>{g.category ?? <i className="text-slate-400">all</i>}</Td>
              <Td><input className={`${cell} w-28 font-mono`} defaultValue={g.gl_account} onBlur={(e) => e.target.value !== g.gl_account && save(g, { gl_account: e.target.value })} /></Td>
              <Td><input className={cell} defaultValue={g.gl_name} onBlur={(e) => e.target.value !== g.gl_name && save(g, { gl_name: e.target.value })} /></Td></tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

function Settings({ m }: { m: Masters }) {
  const [msg, setMsg] = useState<string | null>(null)
  async function save(key: string, value: string) { const { error } = await supabase.from('fleet_settings').upsert({ key, value }, { onConflict: 'key' }); if (error) setMsg(error.message); else await m.reload() }
  const extra = [{ key: 'vat_rate', description: 'VAT rate % used when a file has no VAT column', value: m.setting('vat_rate') || '15' }]
  const all = [...m.settings, ...extra.filter((e) => !m.settings.some((s) => s.key === e.key))]
  return (
    <div className="space-y-3">
      <Alert tone="blue">Contra (balance-sheet / creditor) accounts used on the journals. Leave blank and the journal shows the setting name in capitals so the accountant can see what is missing.</Alert>
      {msg && <Alert tone="red">{msg}</Alert>}
      <Card>
        <Table head={['Setting', 'Value', 'Description']}>
          {all.map((s) => <tr key={s.key}><Td className="font-mono text-xs">{s.key}</Td><Td><input className={`${cell} w-72`} defaultValue={s.value} onBlur={(e) => e.target.value !== s.value && save(s.key, e.target.value)} /></Td><Td className="text-xs text-slate-500">{s.description}</Td></tr>)}
        </Table>
      </Card>
    </div>
  )
}

function Users({ m }: { m: Masters }) {
  // One login for every ASI app (shared Supabase auth). Access per app is granted here and stored in each app's own table.
  type AuthUser = { id: string; email: string; created_at: string; last_sign_in_at: string | null }
  type Ex = { id: string; email: string; name: string; app_role: string; job_role: string | null }
  type Bu = { user_id: string; email: string; full_name: string; is_admin: boolean; must_change_password: boolean }
  type Ba = { user_id: string; cost_centre_id: number; role: string }
  type Cc = { id: number; code: string; name: string; active: boolean }
  type Fl = { user_id: string; email: string; full_name: string; role: string; is_admin: boolean; employee_id: number | null; must_change_password: boolean; view_all?: boolean }
  const [d, setD] = useState<{ users: AuthUser[]; excellence: Ex[]; budget: Bu[]; assignments: Ba[]; cost_centres: Cc[]; fleet: Fl[] } | null>(null)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null); const [busy, setBusy] = useState(false); const [q, setQ] = useState('')
  const [form, setForm] = useState({ email: '', full_name: '', password: '', employee_id: '', fleet_role: 'driver', budget: false, budget_admin: false, excellence_role: '', job_role: '' })
  const [ccFor, setCcFor] = useState<string | null>(null)
  const EX_JOBS = ['', 'branch_manager', 'admin_manager', 'sheq_co_ordinator']
  async function call(body: object) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('fleet-admin-users', { body })
    setBusy(false)
    if (error || data?.error) { setMsg({ tone: 'red', text: error?.message ?? data.error }); return null }
    return data as Record<string, unknown>
  }
  const load = async () => { const r = await call({ action: 'list' }); if (r) setD(r as typeof d) }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  function pickEmp(id: string) { const e = m.employees.find((x) => x.id === Number(id)); setForm({ ...form, employee_id: id, full_name: e?.full_name ?? form.full_name, email: e?.email ?? form.email }) }
  async function create() {
    if (!form.email) { setMsg({ tone: 'red', text: 'E-mail is required.' }); return }
    const r = await call({ action: 'create', email: form.email.trim(), full_name: form.full_name.trim(), password: form.password || null, fleet_role: form.fleet_role || null, employee_id: form.employee_id ? Number(form.employee_id) : null, budget: form.budget, budget_admin: form.budget_admin, excellence_role: form.excellence_role || null, job_role: form.job_role || null })
    if (!r) return
    setMsg({ tone: 'green', text: r.created ? `Login created for ${form.email}. Temporary password: ${r.temp_password} — they must change it on first sign-in.` : `${form.email} already had a login (from another ASI app) — access added, same password applies${r.temp_password ? `; password set to ${r.temp_password}` : ''}.` })
    setForm({ ...form, email: '', full_name: '', password: '', employee_id: '' }); await load()
  }
  const name = (u: AuthUser) => d?.fleet.find((x) => x.user_id === u.id)?.full_name || d?.budget.find((x) => x.user_id === u.id)?.full_name || d?.excellence.find((x) => x.id === u.id)?.name || m.employees.find((e) => e.email?.toLowerCase() === u.email.toLowerCase())?.full_name || ''
  const rows = (d?.users ?? []).filter((u) => !q || `${u.email} ${name(u)}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => name(a).localeCompare(name(b)) || a.email.localeCompare(b.email))
  const sel = 'rounded border border-slate-200 bg-white px-1 py-0.5 text-xs'
  return (
    <div className="space-y-3">
      <Alert tone="blue">One login works across <b>ASI Fleet</b>, <b>ASI Budget</b> and <b>ASI Excellence</b> — they share the same sign-in. Create a person once, then tick what each app may show them. Fleet roles: driver (own logs), manager (approves), payroll / finance / admin. Budget: user with cost centres as compiler or approver, or admin. Excellence: employee, appraiser or admin, plus a job role.</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="Add a login">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Card holder"><Select value={form.employee_id} onChange={(e) => pickEmp(e.target.value)}><option value="">— not a card holder —</option>{m.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</Select></Field>
          <Field label="Full name"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-64" /></Field>
          <Field label="Temporary password" hint="blank = generated"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-36" /></Field>
          <Field label="Fleet"><Select value={form.fleet_role} onChange={(e) => setForm({ ...form, fleet_role: e.target.value })}><option value="">no access</option>{['driver', 'manager', 'payroll', 'finance', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
          <Field label="Budget"><Select value={form.budget ? (form.budget_admin ? 'admin' : 'user') : ''} onChange={(e) => setForm({ ...form, budget: e.target.value !== '', budget_admin: e.target.value === 'admin' })}><option value="">no access</option><option value="user">user</option><option value="admin">admin</option></Select></Field>
          <Field label="Excellence"><Select value={form.excellence_role} onChange={(e) => setForm({ ...form, excellence_role: e.target.value })}><option value="">no access</option><option value="employee">employee</option><option value="appraiser">appraiser</option><option value="admin">admin</option></Select></Field>
          {form.excellence_role && <Field label="Job role"><Select value={form.job_role} onChange={(e) => setForm({ ...form, job_role: e.target.value })}>{EX_JOBS.map((j) => <option key={j} value={j}>{j || '—'}</option>)}</Select></Field>}
          <Button disabled={busy} onClick={() => void create()}>Add</Button>
        </div>
      </Card>
      <Card title={`Logins (${rows.length})`} actions={<Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {!d ? <Spinner /> : rows.length === 0 ? <Empty>No users.</Empty> : (
          <Table head={['Person', 'Last sign-in', 'Fleet', 'Card holder', 'Budget', 'Cost centres', 'Excellence', 'Job role', '']}>
            {rows.map((u) => {
              const fl = d.fleet.find((x) => x.user_id === u.id); const bu = d.budget.find((x) => x.user_id === u.id); const ex = d.excellence.find((x) => x.id === u.id)
              const ba = d.assignments.filter((a) => a.user_id === u.id); const nm = name(u)
              const isMe = false
              return (
                <tr key={u.id} className={ccFor === u.id ? 'bg-brand-card/60' : ''}>
                  <Td><div className="font-medium">{nm || <span className="text-slate-400">(no name)</span>}</div><div className="text-xs text-slate-500">{u.email}</div></Td>
                  <Td className="text-xs text-slate-500">{u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'never'}{(fl?.must_change_password || bu?.must_change_password) ? <div><Badge tone="amber">temp password</Badge></div> : null}</Td>
                  <Td><select className={sel} value={fl?.role ?? ''} disabled={busy || !!isMe} onChange={(e) => void call({ action: 'set_fleet', user_id: u.id, email: u.email, name: nm, role: e.target.value || null }).then(load)}><option value="">none</option>{['driver', 'manager', 'payroll', 'finance', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
                    {fl && !['admin', 'finance', 'payroll'].includes(fl.role) && <label className="mt-1 block whitespace-nowrap text-[11px] text-slate-500" title="Read-only access to the fleet dashboard showing every vehicle and its costs"><input type="checkbox" checked={!!fl.view_all} disabled={busy} onChange={(e) => void supabase.from('fleet_profiles').update({ view_all: e.target.checked }).eq('user_id', fl.user_id).then(load)} /> all-vehicle dashboard</label>}</Td>
                  <Td>{fl ? <select className={`${sel} w-44`} value={fl.employee_id ?? ''} disabled={busy} onChange={(e) => void call({ action: 'set_fleet', user_id: u.id, email: u.email, name: nm, role: fl.role, employee_id: e.target.value ? Number(e.target.value) : null }).then(load)}><option value="">— not linked —</option>{m.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</select> : <span className="text-xs text-slate-300">—</span>}</Td>
                  <Td><select className={sel} value={bu ? (bu.is_admin ? 'admin' : 'user') : ''} disabled={busy} onChange={(e) => void call({ action: 'set_budget', user_id: u.id, email: u.email, name: nm, enabled: e.target.value !== '', is_admin: e.target.value === 'admin' }).then(load)}><option value="">none</option><option value="user">user</option><option value="admin">admin</option></select></Td>
                  <Td className="text-xs">{bu ? <button type="button" className="text-brand-purple hover:underline" onClick={() => setCcFor(ccFor === u.id ? null : u.id)}>{ba.length ? ba.map((a) => `${d.cost_centres.find((c) => c.id === a.cost_centre_id)?.code ?? '?'} ${a.role === 'approver' ? '✓' : ''}`).join(', ') : bu.is_admin ? 'all (admin)' : 'none — set'}</button> : <span className="text-slate-300">—</span>}
                    {ccFor === u.id && bu && (
                      <div className="mt-1 grid max-w-md grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-slate-200 bg-white p-2">
                        {d.cost_centres.filter((c) => c.active).map((c) => { const cur = ba.find((a) => a.cost_centre_id === c.id)?.role ?? ''; return (
                          <label key={c.id} className="flex items-center justify-between gap-1"><span>{c.code} <span className="text-slate-400">{c.name}</span></span>
                            <select className={sel} value={cur} disabled={busy} onChange={(e) => { const next = ba.filter((a) => a.cost_centre_id !== c.id).map((a) => ({ cost_centre_id: a.cost_centre_id, role: a.role })); if (e.target.value) next.push({ cost_centre_id: c.id, role: e.target.value }); void call({ action: 'set_budget', user_id: u.id, email: u.email, name: nm, enabled: true, is_admin: bu.is_admin, assignments: next }).then(load) }}><option value="">—</option><option value="compiler">compiler</option><option value="approver">approver</option></select>
                          </label>) })}
                        <div className="col-span-2 text-right"><button type="button" className="text-brand-purple hover:underline" onClick={() => setCcFor(null)}>done</button></div>
                      </div>
                    )}
                  </Td>
                  <Td><select className={sel} value={ex?.app_role ?? ''} disabled={busy} onChange={(e) => void call({ action: 'set_excellence', user_id: u.id, email: u.email, name: nm, app_role: e.target.value || null, job_role: ex?.job_role ?? null }).then(load)}><option value="">none</option><option value="employee">employee</option><option value="appraiser">appraiser</option><option value="admin">admin</option></select></Td>
                  <Td>{ex ? <select className={sel} value={ex.job_role ?? ''} disabled={busy} onChange={(e) => void call({ action: 'set_excellence', user_id: u.id, email: u.email, name: nm, app_role: ex.app_role, job_role: e.target.value || null }).then(load)}>{EX_JOBS.map((j) => <option key={j} value={j}>{j || '—'}</option>)}</select> : <span className="text-xs text-slate-300">—</span>}</Td>
                  <Td className="space-x-2 whitespace-nowrap">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void call({ action: 'reset_password', user_id: u.id }).then((r) => { if (r) setMsg({ tone: 'green', text: `Temporary password for ${u.email}: ${r.temp_password} — they must change it on first sign-in.` }) }) }}>Reset pw</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm(`Delete the login ${u.email} from ALL apps?`)) void call({ action: 'delete', user_id: u.id }).then(load) }}>Delete</Button>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
    </div>
  )
}

function Notifications() {
  const [rows, setRows] = useState<Notification[]>([]); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const load = () => supabase.from('fleet_notifications').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => setRows((data ?? []) as Notification[]))
  useEffect(() => { void load() }, [])
  async function sendNow() {
    setBusy(true); const { data, error } = await supabase.functions.invoke('fleet-notify'); setBusy(false)
    setMsg(error ? `Could not reach the mail function: ${error.message}` : data?.error ? data.error : `Sent ${data?.sent ?? 0} e-mail(s).`); await load()
  }
  async function retry(n: Notification) { await supabase.from('fleet_notifications').update({ status: 'pending', error: null }).eq('id', n.id); await load() }
  const pending = rows.filter((r) => r.status === 'pending').length
  return (
    <div className="space-y-3">
      <Alert tone="blue">Approval e-mails are queued here when a log is submitted or decided, and sent by the <code>fleet-notify</code> function (needs a Resend API key configured on the Supabase project). {pending > 0 && <b>{pending} pending.</b>}</Alert>
      {msg && <Alert tone="amber">{msg}</Alert>}
      <Card title="Queue" actions={<Button size="sm" disabled={busy} onClick={() => void sendNow()}>Send pending now</Button>}>
        {rows.length === 0 ? <Empty>No notifications yet.</Empty> : (
          <Table head={['Created', 'Kind', 'To', 'Subject', 'Status', '']}>
            {rows.map((n) => <tr key={n.id}><Td className="text-xs">{new Date(n.created_at).toLocaleString('en-ZA')}</Td><Td className="text-xs">{n.kind}</Td><Td className="text-xs">{n.to_email}{n.cc_email && <div className="text-slate-400">cc {n.cc_email}</div>}</Td><Td title={n.body}>{n.subject}</Td><Td><Badge tone={statusTone(n.status)}>{n.status}</Badge>{n.error && <div className="max-w-xs truncate text-xs text-red-600" title={n.error}>{n.error}</div>}</Td><Td>{n.status === 'failed' && <Button size="sm" variant="ghost" onClick={() => void retry(n)}>Retry</Button>}</Td></tr>)}
          </Table>
        )}
      </Card>
    </div>
  )
}
