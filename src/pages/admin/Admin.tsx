import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters, type Masters } from '../../hooks/useMasters'
import { CATEGORIES, type ClaimRate, type GlMap, type Notification, type Profile } from '../../lib/types'
import { fmtDate } from '../../lib/format'
import { Page, Card, Button, Table, Td, Alert, Badge, statusTone, Input, Select, Spinner, Empty, Field } from '../../components/ui'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-brand-lilac focus:bg-white focus:outline-none'

export default function Admin() {
  const m = useMasters()
  return (
    <Page title="Admin" subtitle="Claim rates, GL mapping, contra accounts, users and e-mail notifications.">
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-brand-hairline pb-2"><NavLink to="/admin/rates" className={tab}>Claim rates</NavLink><NavLink to="/admin/gl" className={tab}>GL map</NavLink><NavLink to="/admin/settings" className={tab}>Settings</NavLink><NavLink to="/admin/users" className={tab}>Users</NavLink><NavLink to="/admin/notifications" className={tab}>E-mail queue</NavLink></nav>
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
  const [profiles, setProfiles] = useState<Profile[]>([]); const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null); const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'driver', employee_id: '' })
  const load = () => supabase.from('fleet_profiles').select('*').order('full_name').then(({ data }) => setProfiles((data ?? []) as Profile[]))
  useEffect(() => { void load() }, [])
  async function call(body: object) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('fleet-admin-users', { body })
    setBusy(false)
    if (error || data?.error) { setMsg({ tone: 'red', text: error?.message ?? data.error }); return false }
    await load(); return true
  }
  async function create() {
    if (!form.email || !form.password) { setMsg({ tone: 'red', text: 'E-mail and password are required.' }); return }
    if (await call({ action: 'create', ...form, employee_id: form.employee_id ? Number(form.employee_id) : null })) { setForm({ ...form, email: '', password: '', full_name: '', employee_id: '' }); setMsg({ tone: 'green', text: 'User created. They must change the password at first login.' }) }
  }
  function pickEmp(id: string) { const e = m.employees.find((x) => x.id === Number(id)); setForm({ ...form, employee_id: id, full_name: e?.full_name ?? form.full_name, email: e?.email ?? form.email }) }
  async function update(p: Profile, patch: Partial<Profile>) { const { error } = await supabase.from('fleet_profiles').update(patch).eq('user_id', p.user_id); if (error) setMsg({ tone: 'red', text: error.message }); else await load() }
  return (
    <div className="space-y-3">
      <Alert tone="blue">Everyone who must complete a travel log or approve one needs a login here, linked to their card-holder record. Roles: <b>driver</b> (own logs), <b>manager</b> (approves), <b>payroll</b>/<b>finance</b>/<b>admin</b> (everything). Managers are also detected automatically from the card holders' manager field.</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="Create login">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Card holder"><Select value={form.employee_id} onChange={(e) => pickEmp(e.target.value)}><option value="">— not linked —</option>{m.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</Select></Field>
          <Field label="Full name"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-64" /></Field>
          <Field label="Temporary password"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="driver">driver</option><option value="manager">manager</option><option value="payroll">payroll</option><option value="finance">finance</option><option value="admin">admin</option></Select></Field>
          <Button disabled={busy} onClick={() => void create()}>Create</Button>
        </div>
      </Card>
      <Card title={`Logins (${profiles.length})`}>
        {profiles.length === 0 ? <Empty>No users yet.</Empty> : (
          <Table head={['Name', 'E-mail', 'Role', 'Admin', 'Linked card holder', 'Must change pw', '']}>
            {profiles.map((p) => (
              <tr key={p.user_id}>
                <Td>{p.full_name}</Td><Td className="text-xs">{p.email}</Td>
                <Td><select className={cell} value={p.role} onChange={(e) => update(p, { role: e.target.value as Profile['role'] })}>{['driver', 'manager', 'payroll', 'finance', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></Td>
                <Td><input type="checkbox" checked={p.is_admin} onChange={(e) => update(p, { is_admin: e.target.checked })} /></Td>
                <Td><select className={`${cell} w-48`} value={p.employee_id ?? ''} onChange={(e) => update(p, { employee_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{m.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</select></Td>
                <Td>{p.must_change_password ? <Badge tone="amber">yes</Badge> : ''}</Td>
                <Td className="space-x-2 whitespace-nowrap">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { const pw = prompt(`New temporary password for ${p.email}:`); if (pw) void call({ action: 'reset_password', user_id: p.user_id, password: pw }) }}>Reset pw</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm(`Delete login ${p.email}?`)) void call({ action: 'delete', user_id: p.user_id }) }}>Delete</Button>
                </Td>
              </tr>
            ))}
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
