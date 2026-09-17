import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { currentPeriod, money, num, periodLabel, prevPeriod } from '../../lib/format'
import { downloadWorkbook } from '../../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Select, Spinner, Empty, Stat } from '../../components/ui'

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
  const [rows, setRows] = useState<Row[] | null>(null); const [showGone, setShowGone] = useState(false)
  const [filt, setFilt] = useState<Record<string, string>>({}); const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'total', dir: -1 })
  const from = prevPeriod(to, months - 1)
  useEffect(() => { setRows(null); void supabase.rpc('fleet_branch_vehicles', { p_from: from, p_to: to }).then(({ data }) => setRows((data ?? []) as Row[])) }, [from, to])
  const branches = useMemo(() => { const m = new Map<number, string>(); for (const r of rows ?? []) m.set(r.branch_id, `${r.branch_code} – ${r.branch_name}`); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])) }, [rows])
  // ---- column filters (text contains / select equals / number ≥) and click-to-sort, same behaviour as the Dashboard table
  const colVal = (r: Row, key: string): string | number => {
    if (key === 'vehicle') return `${r.registration} ${r.year ?? ''} ${r.make ?? ''} ${r.model ?? ''}`
    if (key === 'branch') return r.branch_code; if (key === 'owned') return r.ownership === 'avis' ? 'Avis' : 'owned'
    if (key === 'holders') return r.holders ?? ''; if (key === 'tracker') return r.tracking_provider ?? 'none'
    if (key === 'total') return total(r); if (key === 'rpk') return r.km ? total(r) / r.km : 0
    return Number(r[key as keyof Row] || 0)
  }
  const shown = useMemo(() => {
    const out = (rows ?? []).filter((r) => (showGone || r.active) && Object.entries(filt).every(([k, v]) => {
      if (!v) return true; const x = colVal(r, k)
      if (typeof x === 'number') { const n = Number(v.replace(/[^0-9.-]/g, '')); return isNaN(n) ? true : x >= n }
      return k === 'vehicle' || k === 'holders' ? String(x).toLowerCase().includes(v.toLowerCase()) : String(x) === v
    }))
    out.sort((a, b) => { const x = colVal(a, sort.key), y = colVal(b, sort.key); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir })
    return out
  }, [rows, showGone, filt, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const th = (key: string, label: string) => <button type="button" className="inline-flex items-center gap-1 uppercase" onClick={() => setSort((sv) => ({ key, dir: sv.key === key ? (sv.dir === 1 ? -1 : 1) : ['vehicle', 'branch', 'owned', 'holders', 'tracker'].includes(key) ? 1 : -1 }))}>{label}{sort.key === key && <span className="text-brand-lilac">{sort.dir === 1 ? '▲' : '▼'}</span>}</button>
  const fi = 'w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs font-normal normal-case text-slate-700 focus:border-brand-lilac focus:outline-none'
  const fText = (key: string, ph = 'contains…') => <input className={fi} placeholder={ph} value={filt[key] ?? ''} onChange={(e) => setFilt({ ...filt, [key]: e.target.value })} />
  const fNum = (key: string) => <input className={`${fi} text-right`} placeholder="≥" value={filt[key] ?? ''} onChange={(e) => setFilt({ ...filt, [key]: e.target.value })} />
  const fSel = (key: string, opts: string[]) => <select className={fi} value={filt[key] ?? ''} onChange={(e) => setFilt({ ...filt, [key]: e.target.value })}><option value="">all</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
  const opt = (key: string) => [...new Set((rows ?? []).map((r) => String(colVal(r, key))))].filter(Boolean).sort()
  const NUM_COLS = ['fuel', 'toll', 'card_fees', 'maintenance', 'avis', 'tracking', 'insurance', 'fines'] as const
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
            <span className="text-xs text-slate-500">{shown.length} of {(rows ?? []).length} vehicles{Object.values(filt).some(Boolean) && <button type="button" className="ml-2 text-brand-purple hover:underline" onClick={() => setFilt({})}>clear filters</button>}</span>
            <label className="text-sm"><input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} /> include sold / returned</label>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={exportXlsx}>Export to Excel</Button>
          </div>
          <Card>
            <Table head={[th('vehicle', 'Vehicle'), th('branch', 'Branch'), th('owned', 'Owned'), th('holders', 'Card holder(s)'), th('tracker', 'Tracker'), th('fuel', 'Fuel & oil'), th('toll', 'Toll'), th('card_fees', 'Card fees'), th('maintenance', 'Maintenance'), th('avis', 'Avis'), th('tracking', 'Tracking'), th('insurance', 'Insurance'), th('fines', 'Fines'), th('total', 'Total'), th('km', 'km'), th('rpk', 'R / km')]}>
              <tr className="bg-brand-card/60">
                <td className="px-1 py-1">{fText('vehicle', 'reg / make / model…')}</td><td className="px-1 py-1">{fSel('branch', opt('branch'))}</td><td className="px-1 py-1">{fSel('owned', opt('owned'))}</td>
                <td className="px-1 py-1">{fText('holders', 'name…')}</td><td className="px-1 py-1">{fSel('tracker', opt('tracker'))}</td>
                {NUM_COLS.map((k) => <td key={k} className="px-1 py-1">{fNum(k)}</td>)}
                <td className="px-1 py-1">{fNum('total')}</td><td className="px-1 py-1">{fNum('km')}</td><td className="px-1 py-1">{fNum('rpk')}</td>
              </tr>
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
                  {NUM_COLS.map((k) => <Td key={k} num><Money v={sum(k) || null} /></Td>)}
                  <Td num><Money v={grand} /></Td><Td num>{km ? num(km) : '–'}</Td><Td num>{km ? money(grand / km) : '–'}</Td></tr>
              )}
              {shown.length === 0 && <tr><Td colSpan={16} className="text-center text-slate-500">No vehicles match the filters.</Td></tr>}
            </Table>
          </Card>
        </>
      )}
    </Page>
  )
}
