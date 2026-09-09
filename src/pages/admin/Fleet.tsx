import { useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { history, place } from '../../lib/alloc'
import { currentPeriod, periodLabel } from '../../lib/format'
import { useMasters, type Masters } from '../../hooks/useMasters'
import { CATEGORIES, type Allocation, type Card as CardT, type Category, type Employee, type Vehicle } from '../../lib/types'
import { normReg, parseFaNameCode, empNoFromDriver } from '../../lib/match'
import { Page, Card, Button, Table, Td, Alert, Badge, Input, Select, Spinner, Empty } from '../../components/ui'
import { downloadWorkbook } from '../../lib/xlsx'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-brand-lilac focus:bg-white focus:outline-none'

export default function Fleet() {
  const m = useMasters()
  return (
    <Page title="Fleet masters" subtitle="Vehicles, First Auto cards and card holders — and which branch and category each one is allocated to. Every cost (fuel, maintenance, Avis, tracking, insurance, claims) follows the allocation in force for the month of the cost; a change from a given month leaves earlier months on the old branch.">
      <nav className="mb-4 flex gap-1 border-b border-brand-hairline pb-2"><NavLink to="/fleet/vehicles" className={tab}>Vehicles</NavLink><NavLink to="/fleet/cards" className={tab}>Fleet cards</NavLink><NavLink to="/fleet/employees" className={tab}>Card holders / staff</NavLink><NavLink to="/fleet/moves" className={tab}>Branch changes</NavLink></nav>
      {m.loading ? <Spinner /> : (
        <Routes>
          <Route index element={<Navigate to="vehicles" replace />} />
          <Route path="vehicles" element={<Vehicles m={m} />} />
          <Route path="cards" element={<Cards m={m} />} />
          <Route path="employees" element={<Employees m={m} />} />
          <Route path="moves" element={<Moves m={m} />} />
        </Routes>
      )}
    </Page>
  )
}

function BranchSelect({ m, value, onChange }: { m: Masters; value: number | null; onChange: (v: number | null) => void }) {
  return <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={cell}><option value="">—</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
}
function CatSelect({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cell}><option value="">—</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
}

// ---------------------------------------------------------------- Vehicles
function Vehicles({ m }: { m: Masters }) {
  const [q, setQ] = useState(''); const [showInactive, setShowInactive] = useState(false); const [msg, setMsg] = useState<string | null>(null)
  const [add, setAdd] = useState({ registration: '', year: '', make: '', model: '', branch_id: '', category: 'Ops Cabling', ownership: 'owned' })
  const rows = m.vehicles.filter((v) => (showInactive || v.active) && (!q || `${v.registration} ${v.make} ${v.model} ${m.bm.code(v.branch_id)}`.toLowerCase().includes(q.toLowerCase())))
  async function save(v: Vehicle, patch: Partial<Vehicle>) {
    const { error } = await supabase.from('fleet_vehicles').update(patch).eq('id', v.id); if (error) setMsg(error.message); else await m.reload()
  }
  async function create() {
    const reg = normReg(add.registration); if (!reg) return
    const { data, error } = await supabase.from('fleet_vehicles').insert({ registration: reg, year: Number(add.year) || null, make: add.make, model: add.model, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category, ownership: add.ownership }).select('id').single()
    if (error) { setMsg(error.message); return }
    await supabase.from('fleet_allocations').insert({ vehicle_id: data.id, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category, effective_from: currentPeriod(), note: 'Opening allocation' })
    setAdd({ ...add, registration: '', year: '', make: '', model: '' }); await m.reload()
  }
  function exp() { downloadWorkbook([{ name: 'Vehicles', rows: [['Reg', 'Year', 'Make', 'Model', 'Branch', 'Category', 'Ownership', 'Avis MVA', 'Licence expiry', 'Lease end', 'Tracking', 'Insured value', 'Active'], ...m.vehicles.map((v) => [v.registration, v.year, v.make, v.model, m.bm.code(v.branch_id), v.category, v.ownership, v.avis_mva, v.license_expiry, v.lease_end, v.tracking_provider, v.insured_value, v.active ? 'Y' : 'N'])] }], 'Fleet vehicles.xlsx') }
  return (
    <div className="space-y-3">
      {msg && <Alert tone="red">{msg}</Alert>}
      <div className="flex flex-wrap items-center gap-2"><Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><label className="text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show inactive</label><span className="text-sm text-slate-500">{rows.length} vehicles · {rows.filter((v) => v.ownership === 'avis').length} Avis</span><Button size="sm" variant="secondary" className="ml-auto" onClick={exp}>Export</Button></div>
      <Card title="Add vehicle">
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Registration" value={add.registration} onChange={(e) => setAdd({ ...add, registration: e.target.value })} className="w-32" /><Input placeholder="Year" value={add.year} onChange={(e) => setAdd({ ...add, year: e.target.value })} className="w-20" />
          <Input placeholder="Make" value={add.make} onChange={(e) => setAdd({ ...add, make: e.target.value })} className="w-28" /><Input placeholder="Model" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} className="w-40" />
          <Select value={add.branch_id} onChange={(e) => setAdd({ ...add, branch_id: e.target.value })}><option value="">Branch</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select>
          <Select value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={add.ownership} onChange={(e) => setAdd({ ...add, ownership: e.target.value })}><option value="owned">Owned</option><option value="avis">Avis</option><option value="other">Other</option></Select>
          <Button onClick={() => void create()}>Add</Button>
        </div>
      </Card>
      <Card>
        <Table head={['Reg', 'Year', 'Make', 'Model', 'Branch', 'Category', 'Ownership', 'Licence exp.', 'Lease end', 'Tracking', 'Insured', 'Active']}>
          {rows.map((v) => (
            <tr key={v.id} className={v.active ? '' : 'opacity-50'}>
              <Td className="font-medium">{v.registration}</Td>
              <Td><input className={`${cell} w-16`} defaultValue={v.year ?? ''} onBlur={(e) => Number(e.target.value) !== v.year && save(v, { year: Number(e.target.value) || null })} /></Td>
              <Td><input className={cell} defaultValue={v.make ?? ''} onBlur={(e) => e.target.value !== v.make && save(v, { make: e.target.value })} /></Td>
              <Td><input className={cell} defaultValue={v.model ?? ''} onBlur={(e) => e.target.value !== v.model && save(v, { model: e.target.value })} /></Td>
              <Td colSpan={2}><AllocCell m={m} k={{ vehicle_id: v.id }} /></Td>
              <Td><select className={cell} value={v.ownership} onChange={(e) => save(v, { ownership: e.target.value as Vehicle['ownership'] })}><option value="owned">owned</option><option value="avis">avis</option><option value="other">other</option></select></Td>
              <Td><input type="date" className={cell} defaultValue={v.license_expiry ?? ''} onBlur={(e) => (e.target.value || null) !== v.license_expiry && save(v, { license_expiry: e.target.value || null })} /></Td>
              <Td><input type="date" className={cell} defaultValue={v.lease_end ?? ''} onBlur={(e) => (e.target.value || null) !== v.lease_end && save(v, { lease_end: e.target.value || null })} /></Td>
              <Td><input className={`${cell} w-20`} defaultValue={v.tracking_provider ?? ''} onBlur={(e) => e.target.value !== (v.tracking_provider ?? '') && save(v, { tracking_provider: e.target.value || null })} /></Td>
              <Td num>{v.insured_value?.toLocaleString('en-ZA') ?? ''}</Td>
              <Td><input type="checkbox" checked={v.active} onChange={(e) => save(v, { active: e.target.checked })} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Cards
function Cards({ m }: { m: Masters }) {
  const [q, setQ] = useState(''); const [only, setOnly] = useState<'all' | 'unallocated' | 'staff' | 'vehicle'>('all'); const [msg, setMsg] = useState<string | null>(null)
  const rows = useMemo(() => m.cards.filter((c) => (only === 'all' || c.holder_type === only) && (!q || `${c.fa_driver_name} ${c.fa_reg}`.toLowerCase().includes(q.toLowerCase()))), [m.cards, only, q])
  async function save(c: CardT, patch: Partial<CardT>) {
    const p = { ...patch }
    if (p.vehicle_id) { const v = m.vehicles.find((x) => x.id === p.vehicle_id); p.holder_type = 'vehicle'; p.employee_id = null; p.branch_id ??= v?.branch_id ?? c.branch_id; p.category ??= v?.category ?? c.category }
    if (p.employee_id) { const e = m.employees.find((x) => x.id === p.employee_id); p.holder_type = 'staff'; p.vehicle_id = null; p.branch_id ??= e?.branch_id ?? c.branch_id; p.category ??= e?.category ?? c.category }
    if (p.holder_type === 'unallocated') { p.vehicle_id = null; p.employee_id = null }
    const { error } = await supabase.from('fleet_cards').update(p).eq('id', c.id); if (error) setMsg(error.message); else await m.reload()
  }
  async function autoAllocate() {
    let n = 0
    for (const c of m.cards.filter((x) => x.holder_type === 'unallocated')) {
      const empNo = empNoFromDriver(c.fa_driver_name); const e = empNo ? m.employees.find((x) => x.emp_no === empNo) : null
      const v = !empNo ? m.vehicles.find((x) => normReg(x.registration) === normReg(c.fa_reg)) : null
      if (e) { await supabase.from('fleet_cards').update({ holder_type: 'staff', employee_id: e.id, branch_id: c.branch_id ?? e.branch_id, category: c.category ?? e.category }).eq('id', c.id); n++ }
      else if (v) { await supabase.from('fleet_cards').update({ holder_type: 'vehicle', vehicle_id: v.id, branch_id: c.branch_id ?? v.branch_id, category: c.category ?? v.category }).eq('id', c.id); n++ }
    }
    await m.reload(); setMsg(`${n} card${n === 1 ? '' : 's'} allocated automatically.`)
  }
  const unalloc = m.cards.filter((c) => c.holder_type === 'unallocated').length
  return (
    <div className="space-y-3">
      {msg && <Alert tone="blue">{msg}</Alert>}
      {unalloc > 0 && <Alert tone="amber">{unalloc} card{unalloc > 1 ? 's are' : ' is'} not allocated to a vehicle or person — their statement lines will land in UNALLOCATED on the journal. <Button size="sm" variant="secondary" onClick={() => void autoAllocate()}>Try auto-allocate</Button></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search driver / reg…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}><option value="all">All cards</option><option value="unallocated">Unallocated</option><option value="staff">Staff cards</option><option value="vehicle">Vehicle cards</option></Select>
        <span className="text-sm text-slate-500">{rows.length} cards</span>
      </div>
      <Card>
        <p className="mb-2 text-xs text-slate-500">A card is identified by the driver name + registration printed on the First Auto statement. Staff cards deduct from the person's salary; vehicle cards are company cost. A linked card takes its branch and category from the vehicle's or person's allocation (Vehicles / Card holders tabs); only unallocated cards carry their own.</p>
        <Table head={['Driver name (statement)', 'Reg (statement)', 'Holder', 'Vehicle', 'Employee', 'Branch', 'Category', 'Deduct', 'Active']}>
          {rows.map((c) => {
            const hint = parseFaNameCode(c.notes ?? '')
            return (
              <tr key={c.id} className={c.holder_type === 'unallocated' ? 'bg-amber-50' : ''}>
                <Td className="font-medium">{c.fa_driver_name}</Td><Td>{c.fa_reg}</Td>
                <Td><Badge tone={c.holder_type === 'staff' ? 'purple' : c.holder_type === 'vehicle' ? 'teal' : 'amber'}>{c.holder_type}</Badge></Td>
                <Td><select className={`${cell} w-40`} value={c.vehicle_id ?? ''} onChange={(e) => save(c, e.target.value ? { vehicle_id: Number(e.target.value) } : { holder_type: 'unallocated' })}><option value="">—</option>{m.vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration} {v.make}</option>)}</select></Td>
                <Td><select className={`${cell} w-48`} value={c.employee_id ?? ''} onChange={(e) => save(c, e.target.value ? { employee_id: Number(e.target.value) } : { holder_type: 'unallocated' })}><option value="">—</option>{m.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</select></Td>
                {c.holder_type === 'unallocated' ? <>
                  <Td><BranchSelect m={m} value={c.branch_id} onChange={(b) => save(c, { branch_id: b })} />{hint.branchCode && !c.branch_id && <span className="text-xs text-slate-400">statement: {hint.branchCode}</span>}</Td>
                  <Td><CatSelect value={c.category} onChange={(v) => save(c, { category: v as CardT['category'] })} /></Td>
                </> : (() => { const p = place(m, c, currentPeriod()); return <>
                  <Td><span className="font-medium">{m.bm.code(p.branch_id) || '—'}</span> <span className="text-xs text-slate-400">follows the {c.holder_type === 'staff' ? 'person' : 'vehicle'}</span></Td>
                  <Td className="text-xs">{p.category ?? '—'}</Td>
                </> })()}
                <Td>{c.holder_type === 'staff' && <span className="flex items-center gap-1"><input type="checkbox" title="Recover from salary (untick for directors' cards)" checked={c.deduct !== false} onChange={(e) => save(c, { deduct: e.target.checked })} />{c.deduct === false && <input className={`${cell} w-24`} title="Deducted from this usage month onward (YYYY-MM)" placeholder="from YYYY-MM" defaultValue={c.deduct_from ?? ''} onBlur={(e) => (e.target.value || null) !== c.deduct_from && save(c, { deduct_from: e.target.value || null })} />}</span>}</Td>
                <Td><input type="checkbox" checked={c.active} onChange={(e) => save(c, { active: e.target.checked })} /></Td>
              </tr>
            )
          })}
        </Table>
        {rows.length === 0 && <Empty>No cards match.</Empty>}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Employees
function Employees({ m }: { m: Masters }) {
  const [q, setQ] = useState(''); const [msg, setMsg] = useState<string | null>(null)
  const [add, setAdd] = useState({ emp_no: '', full_name: '', email: '', branch_id: '', category: 'Sales' })
  const rows = m.employees.filter((e) => !q || `${e.emp_no} ${e.full_name} ${e.email}`.toLowerCase().includes(q.toLowerCase()))
  async function save(e: Employee, patch: Partial<Employee>) { const { error } = await supabase.from('fleet_employees').update(patch).eq('id', e.id); if (error) setMsg(error.message); else await m.reload() }
  async function create() {
    if (!add.full_name) return
    const { data, error } = await supabase.from('fleet_employees').insert({ emp_no: add.emp_no.padStart(4, '0') || null, full_name: add.full_name, email: add.email || null, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category }).select('id').single()
    if (error) { setMsg(error.message); return }
    await supabase.from('fleet_allocations').insert({ employee_id: data.id, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category, effective_from: currentPeriod(), note: 'Opening allocation' })
    setAdd({ ...add, emp_no: '', full_name: '', email: '' }); await m.reload()
  }
  const guessed = m.employees.filter((e) => e.notes?.includes('auto-generated')).length
  return (
    <div className="space-y-3">
      {msg && <Alert tone="red">{msg}</Alert>}
      {guessed > 0 && <Alert tone="amber">{guessed} e-mail addresses were generated from names (firstname.surname@asiconnect.co.za) and still need checking — approval mails go to these addresses. Clear the note once verified.</Alert>}
      <Card title="Add card holder">
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Emp no" value={add.emp_no} onChange={(e) => setAdd({ ...add, emp_no: e.target.value })} className="w-20" /><Input placeholder="Full name" value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} className="w-48" /><Input placeholder="E-mail" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} className="w-64" />
          <Select value={add.branch_id} onChange={(e) => setAdd({ ...add, branch_id: e.target.value })}><option value="">Branch</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select>
          <Select value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Button onClick={() => void create()}>Add</Button>
        </div>
      </Card>
      <div className="flex items-center gap-2"><Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="text-sm text-slate-500">{rows.length} people</span></div>
      <Card>
        <Table head={['Emp no', 'Name', 'E-mail', 'Branch', 'Category', 'Fuel R/km', 'Maint R/km', 'Own vehicle', 'Manager', 'Manager e-mail (override)', 'Active', 'Notes']}>
          {rows.map((e) => (
            <tr key={e.id} className={e.active ? '' : 'opacity-50'}>
              <Td><input className={`${cell} w-16`} defaultValue={e.emp_no ?? ''} onBlur={(ev) => ev.target.value !== (e.emp_no ?? '') && save(e, { emp_no: ev.target.value || null })} /></Td>
              <Td><input className={cell} defaultValue={e.full_name} onBlur={(ev) => ev.target.value !== e.full_name && save(e, { full_name: ev.target.value })} /></Td>
              <Td><input className={`${cell} w-56`} defaultValue={e.email ?? ''} onBlur={(ev) => ev.target.value !== (e.email ?? '') && save(e, { email: ev.target.value || null, notes: e.notes?.includes('auto-generated') ? null : e.notes })} /></Td>
              <Td colSpan={2}><AllocCell m={m} k={{ employee_id: e.id }} /></Td>
              <Td><input type="number" step="0.01" className={`${cell} w-16 text-right`} defaultValue={e.fuel_rate ?? ''} onBlur={(ev) => (ev.target.value === '' ? null : Number(ev.target.value)) !== e.fuel_rate && save(e, { fuel_rate: ev.target.value === '' ? null : Number(ev.target.value) })} /></Td>
              <Td><input type="number" step="0.01" className={`${cell} w-16 text-right`} defaultValue={e.maint_rate ?? ''} onBlur={(ev) => (ev.target.value === '' ? null : Number(ev.target.value)) !== e.maint_rate && save(e, { maint_rate: ev.target.value === '' ? null : Number(ev.target.value) })} /></Td>
              <Td><input className={`${cell} w-24`} defaultValue={e.vehicle_reg ?? ''} onBlur={(ev) => normReg(ev.target.value) !== (e.vehicle_reg ?? '') && save(e, { vehicle_reg: normReg(ev.target.value) || null })} placeholder="reg" /></Td>
              <Td><select className={`${cell} w-44`} value={e.manager_employee_id ?? ''} onChange={(ev) => save(e, { manager_employee_id: ev.target.value ? Number(ev.target.value) : null })}><option value="">—</option>{m.employees.filter((x) => x.id !== e.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></Td>
              <Td><input className={`${cell} w-52`} defaultValue={e.manager_email ?? ''} onBlur={(ev) => ev.target.value !== (e.manager_email ?? '') && save(e, { manager_email: ev.target.value || null })} placeholder="if manager is not a card holder" /></Td>
              <Td><input type="checkbox" checked={e.active} onChange={(ev) => save(e, { active: ev.target.checked })} /></Td>
              <Td className="max-w-xs text-xs text-slate-400">{e.notes}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Allocations (effective-dated branch / category)
const monthLabel = (p: string) => periodLabel(p)
function AllocCell({ m, k }: { m: Masters; k: { vehicle_id?: number; employee_id?: number } }) {
  const hist = history(m.allocations, k); const cur = hist[0]
  const [open, setOpen] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ branch_id: '', category: '' as string, effective_from: currentPeriod(), note: '' })
  function start() { setForm({ branch_id: String(cur?.branch_id ?? ''), category: cur?.category ?? 'Ops Cabling', effective_from: currentPeriod(), note: '' }); setErr(null); setOpen(true) }
  async function save() {
    if (!form.branch_id) { setErr('Choose a branch'); return }
    if (!/^\d{4}-\d{2}$/.test(form.effective_from)) { setErr('Effective month must be YYYY-MM'); return }
    setBusy(true)
    const row = { ...k, branch_id: Number(form.branch_id), category: form.category as Category, effective_from: form.effective_from, note: form.note || null }
    const existing = hist.find((h) => h.effective_from === form.effective_from)
    const { error } = existing ? await supabase.from('fleet_allocations').update(row).eq('id', existing.id) : await supabase.from('fleet_allocations').insert(row)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOpen(false); await m.reload()
  }
  async function remove(a: Allocation) {
    if (hist.length <= 1) { setErr('Keep at least one allocation'); return }
    if (!confirm(`Remove the change to ${m.bm.code(a.branch_id)} / ${a.category} from ${monthLabel(a.effective_from)}? Costs from that month will follow the previous allocation again.`)) return
    const { error } = await supabase.from('fleet_allocations').delete().eq('id', a.id); if (error) setErr(error.message); else await m.reload()
  }
  const since = cur && hist.length > 1 ? ` since ${monthLabel(cur.effective_from)}` : ''
  return (
    <div className="relative min-w-[11rem]">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{cur ? m.bm.code(cur.branch_id) || '—' : '—'}</span>
        <span className="text-xs text-slate-500">{cur?.category ?? ''}{since}</span>
        <button type="button" className="text-xs text-brand-purple hover:underline" onClick={() => (open ? setOpen(false) : start())}>{open ? 'close' : 'change'}</button>
      </div>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
          <div className="mb-2 text-xs font-semibold text-slate-500">Move to</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">Branch<select className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1 text-sm" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">—</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></label>
            <label className="text-xs text-slate-500">Category<select className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs text-slate-500">From usage month<input type="month" className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1 text-sm" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></label>
            <label className="text-xs text-slate-500">Note<input className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1 text-sm" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="why" /></label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Costs dated {monthLabel(form.effective_from || currentPeriod())} onward go to the new branch; earlier months stay where they were.</p>
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          <div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={() => void save()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
          {hist.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="mb-1 text-xs font-semibold text-slate-500">History</div>
              {hist.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                  <span><span className="font-medium">{monthLabel(a.effective_from)}</span> → {m.bm.code(a.branch_id) || '—'} · {a.category}{a.note ? <span className="text-slate-400"> — {a.note}</span> : null}</span>
                  {hist.length > 1 && <button type="button" className="text-slate-400 hover:text-red-600" title="remove this change" onClick={() => void remove(a)}>×</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Branch changes (audit of every move)
function Moves({ m }: { m: Masters }) {
  const [all, setAll] = useState(false); const [q, setQ] = useState('')
  const key = (a: Allocation) => (a.vehicle_id ? `v${a.vehicle_id}` : `e${a.employee_id}`)
  const firstOf = new Map<string, string>(); for (const a of m.allocations) { const k = key(a); if (!firstOf.has(k) || a.effective_from < firstOf.get(k)!) firstOf.set(k, a.effective_from) }
  const who = (a: Allocation) => a.vehicle_id ? (() => { const v = m.vehicles.find((x) => x.id === a.vehicle_id); return v ? `${v.registration} ${v.make ?? ''} ${v.model ?? ''}`.trim() : `vehicle #${a.vehicle_id}` })() : (() => { const e = m.employees.find((x) => x.id === a.employee_id); return e ? `${e.full_name} (${e.emp_no ?? ''})` : `person #${a.employee_id}` })()
  const rows = m.allocations.filter((a) => (all || a.effective_from !== firstOf.get(key(a))) && (!q || `${who(a)} ${m.bm.code(a.branch_id)} ${a.note ?? ''}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at))
  async function remove(a: Allocation) {
    if (m.allocations.filter((x) => key(x) === key(a)).length <= 1) return
    if (!confirm(`Remove the change of ${who(a)} to ${m.bm.code(a.branch_id)} from ${monthLabel(a.effective_from)}?`)) return
    await supabase.from('fleet_allocations').delete().eq('id', a.id); await m.reload()
  }
  const byBranch = new Map<string, number>(); for (const a of m.allocations) { const k = key(a); const latest = m.allocations.filter((x) => key(x) === k).sort((x, y) => y.effective_from.localeCompare(x.effective_from))[0]; if (latest.id === a.id) { const c = m.bm.code(a.branch_id) || '—'; byBranch.set(c, (byBranch.get(c) ?? 0) + 1) } }
  return (
    <div className="space-y-3">
      <Alert tone="blue">Every branch or category change made on the Vehicles and Card holders tabs is listed here with the usage month it applies from. Journals and the dashboard place each month's costs by the allocation in force that month, so history is never re-stated. The opening allocations (July 2026) came from the fleet master corrected to the Budget app.</Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include opening allocations</label>
        <span className="text-sm text-slate-500">{rows.length} {all ? 'allocations' : 'changes'}</span>
        <span className="ml-auto text-xs text-slate-500">Currently: {[...byBranch].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}</span>
      </div>
      <Card>
        <Table head={['From month', 'Vehicle / person', 'Branch', 'Category', 'Note', 'Recorded', '']}>
          {rows.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{monthLabel(a.effective_from)}</Td><Td>{who(a)}</Td><Td><Badge tone={a.vehicle_id ? 'teal' : 'purple'}>{m.bm.code(a.branch_id) || '—'}</Badge></Td><Td className="text-xs">{a.category}</Td>
              <Td className="max-w-xs text-xs text-slate-500">{a.note}</Td><Td className="text-xs text-slate-400">{a.created_at.slice(0, 10)}</Td>
              <Td>{a.effective_from !== firstOf.get(key(a)) && <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => void remove(a)}>remove</button>}</Td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <Empty>{all ? 'No allocations yet.' : 'No branch changes recorded yet — use "change" next to a vehicle or person.'}</Empty>}
      </Card>
    </div>
  )
}
