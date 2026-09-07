import { useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters, type Masters } from '../../hooks/useMasters'
import { CATEGORIES, type Card as CardT, type Employee, type Vehicle } from '../../lib/types'
import { normReg, parseFaNameCode, empNoFromDriver } from '../../lib/match'
import { Page, Card, Button, Table, Td, Alert, Badge, Input, Select, Spinner, Empty } from '../../components/ui'
import { downloadWorkbook } from '../../lib/xlsx'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-brand-lilac focus:bg-white focus:outline-none'

export default function Fleet() {
  const m = useMasters()
  return (
    <Page title="Fleet masters" subtitle="Vehicles, First Auto cards and card holders — and which branch each one is allocated to.">
      <nav className="mb-4 flex gap-1 border-b border-brand-hairline pb-2"><NavLink to="vehicles" className={tab}>Vehicles</NavLink><NavLink to="cards" className={tab}>Fleet cards</NavLink><NavLink to="employees" className={tab}>Card holders / staff</NavLink></nav>
      {m.loading ? <Spinner /> : (
        <Routes>
          <Route index element={<Navigate to="vehicles" replace />} />
          <Route path="vehicles" element={<Vehicles m={m} />} />
          <Route path="cards" element={<Cards m={m} />} />
          <Route path="employees" element={<Employees m={m} />} />
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
    const { error } = await supabase.from('fleet_vehicles').insert({ registration: reg, year: Number(add.year) || null, make: add.make, model: add.model, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category, ownership: add.ownership })
    if (error) setMsg(error.message); else { setAdd({ ...add, registration: '', year: '', make: '', model: '' }); await m.reload() }
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
              <Td><BranchSelect m={m} value={v.branch_id} onChange={(b) => save(v, { branch_id: b })} /></Td>
              <Td><CatSelect value={v.category} onChange={(c) => save(v, { category: c as Vehicle['category'] })} /></Td>
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
        <p className="mb-2 text-xs text-slate-500">A card is identified by the driver name + registration printed on the First Auto statement. Staff cards deduct from the person's salary; vehicle cards are company cost. Branch and category here drive the journal.</p>
        <Table head={['Driver name (statement)', 'Reg (statement)', 'Holder', 'Vehicle', 'Employee', 'Branch', 'Category', 'Active']}>
          {rows.map((c) => {
            const hint = parseFaNameCode(c.notes ?? '')
            return (
              <tr key={c.id} className={c.holder_type === 'unallocated' ? 'bg-amber-50' : ''}>
                <Td className="font-medium">{c.fa_driver_name}</Td><Td>{c.fa_reg}</Td>
                <Td><Badge tone={c.holder_type === 'staff' ? 'purple' : c.holder_type === 'vehicle' ? 'teal' : 'amber'}>{c.holder_type}</Badge></Td>
                <Td><select className={`${cell} w-40`} value={c.vehicle_id ?? ''} onChange={(e) => save(c, e.target.value ? { vehicle_id: Number(e.target.value) } : { holder_type: 'unallocated' })}><option value="">—</option>{m.vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration} {v.make}</option>)}</select></Td>
                <Td><select className={`${cell} w-48`} value={c.employee_id ?? ''} onChange={(e) => save(c, e.target.value ? { employee_id: Number(e.target.value) } : { holder_type: 'unallocated' })}><option value="">—</option>{m.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</select></Td>
                <Td><BranchSelect m={m} value={c.branch_id} onChange={(b) => save(c, { branch_id: b })} />{hint.branchCode && !c.branch_id && <span className="text-xs text-slate-400">statement: {hint.branchCode}</span>}</Td>
                <Td><CatSelect value={c.category} onChange={(v) => save(c, { category: v as CardT['category'] })} /></Td>
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
    const { error } = await supabase.from('fleet_employees').insert({ emp_no: add.emp_no.padStart(4, '0') || null, full_name: add.full_name, email: add.email || null, branch_id: add.branch_id ? Number(add.branch_id) : null, category: add.category })
    if (error) setMsg(error.message); else { setAdd({ ...add, emp_no: '', full_name: '', email: '' }); await m.reload() }
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
        <Table head={['Emp no', 'Name', 'E-mail', 'Branch', 'Category (claim rate)', 'Manager', 'Manager e-mail (override)', 'Active', 'Notes']}>
          {rows.map((e) => (
            <tr key={e.id} className={e.active ? '' : 'opacity-50'}>
              <Td><input className={`${cell} w-16`} defaultValue={e.emp_no ?? ''} onBlur={(ev) => ev.target.value !== (e.emp_no ?? '') && save(e, { emp_no: ev.target.value || null })} /></Td>
              <Td><input className={cell} defaultValue={e.full_name} onBlur={(ev) => ev.target.value !== e.full_name && save(e, { full_name: ev.target.value })} /></Td>
              <Td><input className={`${cell} w-56`} defaultValue={e.email ?? ''} onBlur={(ev) => ev.target.value !== (e.email ?? '') && save(e, { email: ev.target.value || null, notes: e.notes?.includes('auto-generated') ? null : e.notes })} /></Td>
              <Td><BranchSelect m={m} value={e.branch_id} onChange={(b) => save(e, { branch_id: b })} /></Td>
              <Td><CatSelect value={e.category} onChange={(c) => save(e, { category: c as Employee['category'] })} /></Td>
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
