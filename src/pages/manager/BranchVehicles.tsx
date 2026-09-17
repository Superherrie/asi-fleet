import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { currentPeriod, money, num, periodLabel, prevPeriod } from '../../lib/format'
import { downloadWorkbook } from '../../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Select, Spinner, Empty, Stat, Input } from '../../components/ui'

interface Row {
  vehicle_id: number; registration: string; year: number | null; make: string | null; model: string | null; ownership: string; category: string
  branch_id: number; branch_code: string; branch_name: string; holders: string | null; tracking_provider: string | null; insured_value: number | null
  active: boolean; disposal_type: string | null; disposal_date: string | null
  fuel: number; toll: number; card_fees: number; maintenance: number; avis: number; tracking: number; insurance: number; fines: number; km: number
}
const total = (r: Row) => r.fuel + r.toll + r.card_fees + r.maintenance + r.avis + r.tracking + r.insurance + r.fines

/** Vehicles allocated to the branches the signed-in manager holds in the Budget app (all branches for admins), with their costs for the chosen months. */
export default function BranchVehicles() {
  const { isAdmin } = useAuth()
  const [to, setTo] = useState(prevPeriod(currentPeriod())); const [months, setMonths] = useState(3)
  const [rows, setRows] = useState<Row[] | null>(null); const [branch, setBranch] = useState<number | ''>(''); const [q, setQ] = useState(''); const [showGone, setShowGone] = useState(false)
  const from = prevPeriod(to, months - 1)
  useEffect(() => { setRows(null); void supabase.rpc('fleet_branch_vehicles', { p_from: from, p_to: to }).then(({ data }) => setRows((data ?? []) as Row[])) }, [from, to])
  const branches = useMemo(() => { const m = new Map<number, string>(); for (const r of rows ?? []) m.set(r.branch_id, `${r.branch_code} – ${r.branch_name}`); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])) }, [rows])
  const shown = (rows ?? []).filter((r) => (showGone || r.active) && (branch === '' || r.branch_id === branch) && (!q || `${r.registration} ${r.make} ${r.model} ${r.holders ?? ''}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => total(b) - total(a))
  const sum = (k: keyof Row) => shown.reduce((s, r) => s + Number(r[k] || 0), 0); const grand = shown.reduce((s, r) => s + total(r), 0); const km = sum('km')
  function exportXlsx() {
    const out: (string | number | null)[][] = [['Reg', 'Vehicle', 'Branch', 'Owned / Avis', 'Card holder(s)', 'Tracker', 'Fuel & oil', 'Toll', 'Card fees', 'Maintenance', 'Avis', 'Tracking', 'Insurance', 'Fine fees', 'Total', 'km', 'R/km']]
    for (const r of shown) out.push([r.registration, `${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`.trim(), r.branch_code, r.ownership === 'avis' ? 'Avis' : 'Owned', r.holders, r.tracking_provider, r.fuel, r.toll, r.card_fees, r.maintenance, r.avis, r.tracking, r.insurance, r.fines, total(r), r.km, r.km ? Math.round((total(r) / r.km) * 100) / 100 : null])
    downloadWorkbook([{ name: 'Branch vehicles', rows: out, widths: [11, 30, 8, 12, 28, 16, 12, 10, 10, 12, 12, 10, 10, 10, 12, 8, 8] }], `Branch vehicles ${periodLabel(from)} - ${periodLabel(to)}.xlsx`)
  }
  return (
    <Page title="My branch vehicles" subtitle={isAdmin ? 'All branches (admin). Managers see the vehicles allocated to the branches they hold in the Budget app.' : 'Vehicles allocated to your branches, with what each one cost in the months shown. Costs exclude VAT.'}
      actions={<>
        <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}><option value={1}>1 month</option><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option></Select>
        <Select value={to} onChange={(e) => setTo(e.target.value)}>{Array.from({ length: 18 }, (_, i) => prevPeriod(currentPeriod(), i)).map((p) => <option key={p} value={p}>to {periodLabel(p)}</option>)}</Select>
      </>}>
      {rows === null ? <Spinner /> : rows.length === 0 ? <Empty>No branches are allocated to your login. Branch access follows your cost centres in the Budget app; ask an administrator to add them under Admin → Users & access.</Empty> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Vehicles" value={shown.length} sub={`${branches.length} branch${branches.length === 1 ? '' : 'es'}: ${branches.map(([, n]) => n.split(' – ')[0]).join(', ')}`} />
            <Stat label="Total cost" value={`R ${money(grand)}`} sub={`${periodLabel(from)} – ${periodLabel(to)} · excl VAT`} tone="purple" />
            <Stat label="Cost per km" value={km ? `R ${money(grand / km)}` : '–'} sub={`${num(km)} km on fleet cards`} tone="teal" />
            <Stat label="Fine fees" value={`R ${money(sum('fines'))}`} sub="Avis fine administration" tone={sum('fines') ? 'pink' : undefined} />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input placeholder="Search reg, vehicle, holder…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
            {branches.length > 1 && <Select value={branch} onChange={(e) => setBranch(e.target.value === '' ? '' : Number(e.target.value))}><option value="">All my branches</option>{branches.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>}
            <label className="text-sm"><input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} /> include sold / returned</label>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={exportXlsx}>Export to Excel</Button>
          </div>
          <Card>
            <Table head={['Vehicle', 'Branch', 'Owned', 'Card holder(s)', 'Tracker', 'Fuel & oil', 'Toll', 'Card fees', 'Maintenance', 'Avis', 'Tracking', 'Insurance', 'Fines', 'Total', 'km', 'R / km']}>
              {shown.map((r) => (
                <tr key={r.vehicle_id} className={!r.active ? 'opacity-50' : 'hover:bg-brand-card'}>
                  <Td><div className="font-medium">{r.registration}</div><div className="text-xs text-slate-500">{r.year} {r.make} {r.model}{r.disposal_type && <span className="ml-1 text-amber-700">· {r.disposal_type} {r.disposal_date}</span>}</div></Td>
                  <Td>{r.branch_code}</Td><Td><Badge tone={r.ownership === 'avis' ? 'pink' : 'teal'}>{r.ownership === 'avis' ? 'Avis' : 'owned'}</Badge></Td>
                  <Td className="text-xs">{r.holders}</Td><Td className="text-xs">{r.tracking_provider ?? <span className="text-amber-700">none</span>}</Td>
                  <Td num><Money v={r.fuel || null} /></Td><Td num><Money v={r.toll || null} /></Td><Td num><Money v={r.card_fees || null} /></Td><Td num><Money v={r.maintenance || null} /></Td>
                  <Td num><Money v={r.avis || null} /></Td><Td num><Money v={r.tracking || null} /></Td><Td num><Money v={r.insurance || null} /></Td><Td num><Money v={r.fines || null} /></Td>
                  <Td num className="font-semibold"><Money v={total(r)} /></Td><Td num>{r.km ? num(r.km) : '–'}</Td><Td num>{r.km ? money(total(r) / r.km) : '–'}</Td>
                </tr>
              ))}
              {shown.length > 0 && (
                <tr className="bg-brand-card font-semibold"><Td>Total ({shown.length})</Td><Td /><Td /><Td /><Td />
                  {(['fuel', 'toll', 'card_fees', 'maintenance', 'avis', 'tracking', 'insurance', 'fines'] as (keyof Row)[]).map((k) => <Td key={k} num><Money v={sum(k) || null} /></Td>)}
                  <Td num><Money v={grand} /></Td><Td num>{km ? num(km) : '–'}</Td><Td num>{km ? money(grand / km) : '–'}</Td></tr>
              )}
              {shown.length === 0 && <tr><Td colSpan={16} className="text-center text-slate-500">No vehicles match.</Td></tr>}
            </Table>
          </Card>
        </>
      )}
    </Page>
  )
}
