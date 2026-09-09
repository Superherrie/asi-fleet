import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { place } from '../lib/alloc'
import { useMasters } from '../hooks/useMasters'
import type { AvisLine, FaLine, InsuranceLine, MaintLine, TrackingLine, Claim, Vehicle } from '../lib/types'
import { currentPeriod, money, num, periodLabel, periodRange, prevPeriod } from '../lib/format'
import { Page, Card, Stat, Table, Td, Money, Select, Spinner, Empty, Badge } from '../components/ui'

const TYPES = ['Fuel/Oil', 'Maintenance', 'Toll', 'Lease', 'Tracking', 'Insurance'] as const
type CostType = (typeof TYPES)[number]
const COLORS: Record<CostType, string> = { 'Fuel/Oil': '#7b2fbe', Maintenance: '#0d9488', Toll: '#b45309', Lease: '#e91e63', Tracking: '#2563eb', Insurance: '#64748b' }

interface VehicleCost { vehicle: Vehicle; cost: Record<CostType, number>; km: number; total: number }

export default function Dashboard() {
  const m = useMasters()
  const [to, setTo] = useState(prevPeriod(currentPeriod()))
  const [months, setMonths] = useState(12)
  const [branch, setBranch] = useState<number | ''>('')
  const [fa, setFa] = useState<FaLine[]>([]); const [avis, setAvis] = useState<AvisLine[]>([]); const [ins, setIns] = useState<InsuranceLine[]>([]); const [trk, setTrk] = useState<TrackingLine[]>([]); const [claims, setClaims] = useState<Claim[]>([]); const [maint, setMaint] = useState<MaintLine[]>([])
  const [loading, setLoading] = useState(true)
  const from = prevPeriod(to, months - 1)
  const periods = useMemo(() => periodRange(from, to), [from, to])

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [a, b, c, d, e, f] = await Promise.all([
        supabase.from('fleet_fa_lines').select('*').gte('period', from).lte('period', to),
        supabase.from('fleet_avis_lines').select('*').gte('period', from).lte('period', to),
        supabase.from('fleet_insurance_lines').select('*').gte('period', from).lte('period', to),
        supabase.from('fleet_tracking_lines').select('*').gte('period', from).lte('period', to),
        supabase.from('fleet_claims').select('*').gte('period', from).lte('period', to),
        supabase.from('fleet_maint_lines').select('*').gte('period', from).lte('period', to),
      ])
      setFa((a.data ?? []) as FaLine[]); setAvis((b.data ?? []) as AvisLine[]); setIns((c.data ?? []) as InsuranceLine[]); setTrk((d.data ?? []) as TrackingLine[]); setClaims((e.data ?? []) as Claim[]); setMaint((f.data ?? []) as MaintLine[])
      setLoading(false)
    })()
  }, [from, to])

  // ---- aggregate per vehicle (company cards only) and per branch / month
  const data = useMemo(() => {
    const byVeh = new Map<number, VehicleCost>()
    const byMonth = new Map<string, Record<CostType, number>>(); periods.forEach((p) => byMonth.set(p, zero()))
    const byBranch = new Map<number, number>()
    let staffSpend = 0; let staffMaint = 0
    const vehOf = (id: number | null) => (id ? m.vehicles.find((v) => v.id === id) : undefined)
    const bump = (v: Vehicle | undefined, period: string, type: CostType, amt: number, km = 0, branchId: number | null = null) => {
      const bid = place(m, { vehicle_id: v?.id, branch_id: branchId }, period).branch_id
      if (branch !== '' && bid !== branch) return
      if (v) {
        const e = byVeh.get(v.id) ?? { vehicle: v, cost: zero(), km: 0, total: 0 }
        e.cost[type] += amt; e.total += amt; e.km += km; byVeh.set(v.id, e)
      }
      const mm = byMonth.get(period); if (mm) mm[type] += amt
      if (bid != null) byBranch.set(bid, (byBranch.get(bid) ?? 0) + amt)
    }
    for (const l of fa) {
      const card = m.cards.find((c) => c.id === l.card_id)
      if (!card || card.holder_type !== 'vehicle') { if (card?.holder_type === 'staff' && (branch === '' || place(m, card, l.period).branch_id === branch)) staffSpend += l.grand_total; continue }
      const v = vehOf(card.vehicle_id)
      bump(v, l.period, 'Fuel/Oil', l.fuel + l.oil_excl, l.kms ?? 0, card.branch_id)
      bump(v, l.period, 'Maintenance', l.repairs_excl + l.tyres_excl + l.accident_excl + l.maint_excl + l.overhaul_excl + l.other_excl + l.fees_excl, 0, card.branch_id)
      bump(v, l.period, 'Toll', l.toll_excl, 0, card.branch_id)
    }
    for (const l of maint) { if (l.employee_id) { if (branch === '' || place(m, { employee_id: l.employee_id, branch_id: l.branch_id }, l.period).branch_id === branch) staffMaint += l.total; continue } bump(vehOf(l.vehicle_id), l.period, 'Maintenance', l.excl, 0, l.branch_id) }
    for (const l of avis) bump(vehOf(l.vehicle_id), l.period, 'Lease', l.total, 0, l.branch_id)
    for (const l of trk) bump(vehOf(l.vehicle_id), l.period, 'Tracking', l.amount_excl, 0, l.branch_id)
    for (const l of ins) bump(vehOf(l.vehicle_id), l.period, 'Insurance', l.premium, 0, l.branch_id)
    const claimsTotal = claims.filter((c) => branch === '' || place(m, { employee_id: c.employee_id }, c.period).branch_id === branch).reduce((s, c) => s + c.total_amount, 0)
    const vehicles = [...byVeh.values()].sort((a, b) => b.total - a.total)
    const total = vehicles.reduce((s, v) => s + v.total, 0)
    const km = vehicles.reduce((s, v) => s + v.km, 0)
    return { vehicles, byMonth, byBranch, total, km, staffSpend, staffMaint, claimsTotal }
  }, [fa, avis, trk, ins, claims, maint, m, periods, branch])

  const typeTotals = TYPES.map((t) => [t, data.vehicles.reduce((s, v) => s + v.cost[t], 0)] as const)
  const monthMax = Math.max(1, ...[...data.byMonth.values()].map((r) => TYPES.reduce((s, t) => s + r[t], 0)))
  const branchRows = [...data.byBranch.entries()].map(([id, v]) => ({ code: m.bm.code(id), v })).sort((a, b) => b.v - a.v)
  const branchMax = Math.max(1, ...branchRows.map((b) => b.v))
  const hasData = fa.length + avis.length + trk.length + ins.length + maint.length > 0

  return (
    <Page title="Fleet dashboard" subtitle="Cost of ownership per vehicle, branch and month from the imported statements."
      actions={
        <>
          <Select value={branch} onChange={(e) => setBranch(e.target.value === '' ? '' : Number(e.target.value))}><option value="">All branches</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} – {b.name}</option>)}</Select>
          <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option></Select>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>{periodRange(prevPeriod(currentPeriod(), 24), currentPeriod()).reverse().map((p) => <option key={p} value={p}>to {periodLabel(p)}</option>)}</Select>
        </>
      }>
      {loading || m.loading ? <Spinner /> : !hasData ? <Empty>No statements imported for {periodLabel(from)} – {periodLabel(to)} yet. Use Imports to load First Auto, Avis, insurance and tracking data.</Empty> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Company fleet cost" value={`R ${money(data.total)}`} sub={`${periodLabel(from)} – ${periodLabel(to)} · excl VAT`} />
            <Stat label="Cost per km" value={data.km ? `R ${money(data.total / data.km)}` : '–'} sub={`${num(data.km)} km on statements`} tone="purple" />
            <Stat label="Vehicles with cost" value={data.vehicles.length} sub={`of ${m.vehicles.filter((v) => v.active).length} on the master`} tone="teal" />
            <Stat label="Staff card spend" value={`R ${money(data.staffSpend)}`} sub={`recovered via salary · maintenance on own vehicles R ${money(data.staffMaint)} from accruals`} tone="pink" />
            <Stat label="Travel claims" value={`R ${money(data.claimsTotal)}`} sub="fuel paid + maintenance accrued" />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Card title="Cost by month" className="lg:col-span-2">
              <BarChart rows={periods.map((p) => ({ label: periodLabel(p).replace(' 20', ' ’'), parts: data.byMonth.get(p)! }))} max={monthMax} />
              <Legend />
            </Card>
            <Card title="Cost by branch">
              <div className="space-y-1.5">
                {branchRows.map((b) => (
                  <div key={b.code} className="flex items-center gap-2 text-sm" title={`R ${money(b.v)}`}>
                    <span className="w-10 font-medium">{b.code}</span>
                    <div className="h-4 flex-1 rounded-r bg-brand-card"><div className="h-4 rounded-r bg-brand-purple" style={{ width: `${(b.v / branchMax) * 100}%` }} /></div>
                    <span className="w-24 text-right tabular-nums text-xs text-slate-600">R {num(b.v)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Cost of ownership per vehicle" actions={<span className="text-xs text-slate-500">{typeTotals.map(([t, v]) => `${t} R ${num(v)}`).join(' · ')}</span>}>
            <Table head={['Vehicle', 'Branch', 'Category', 'Owned', ...TYPES, 'Total', 'km', 'R / km', 'Share']}>
              {data.vehicles.map((r) => (
                <tr key={r.vehicle.id} className="hover:bg-brand-card">
                  <Td><div className="font-medium">{r.vehicle.registration}</div><div className="text-xs text-slate-500">{r.vehicle.year} {r.vehicle.make} {r.vehicle.model}</div></Td>
                  <Td>{m.bm.code(r.vehicle.branch_id)}</Td><Td className="text-xs">{r.vehicle.category}</Td>
                  <Td><Badge tone={r.vehicle.ownership === 'avis' ? 'pink' : 'teal'}>{r.vehicle.ownership}</Badge></Td>
                  {TYPES.map((t) => <Td key={t} num><Money v={r.cost[t] || null} /></Td>)}
                  <Td num className="font-semibold"><Money v={r.total} /></Td>
                  <Td num>{num(r.km)}</Td><Td num>{r.km ? money(r.total / r.km) : ''}</Td>
                  <Td><div className="h-2 w-16 rounded bg-brand-card"><div className="h-2 rounded bg-brand-purple" style={{ width: `${(r.total / (data.vehicles[0]?.total || 1)) * 100}%` }} /></div></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </Page>
  )
}

function zero(): Record<CostType, number> { return { 'Fuel/Oil': 0, Maintenance: 0, Toll: 0, Lease: 0, Tracking: 0, Insurance: 0 } }

function BarChart({ rows, max }: { rows: { label: string; parts: Record<CostType, number> }[]; max: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const H = 180
  return (
    <div className="relative">
      <div className="flex h-[220px] items-end gap-2 border-b border-brand-hairline px-1">
        {rows.map((r, i) => {
          const total = TYPES.reduce((s, t) => s + r.parts[t], 0)
          return (
            <div key={r.label} className="flex flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {hover === i && <div className="mb-1 text-[11px] font-semibold tabular-nums text-brand-navy">R {num(total)}</div>}
              <div className="flex w-full max-w-10 flex-col-reverse gap-[2px]" style={{ height: `${(total / max) * H}px` }}>
                {TYPES.map((t) => r.parts[t] > 0 && <div key={t} style={{ flex: r.parts[t], background: COLORS[t], minHeight: 2 }} className="rounded-[2px] first:rounded-t-[4px]" title={`${t}: R ${money(r.parts[t])}`} />)}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">{r.label}</div>
            </div>
          )
        })}
      </div>
      {hover != null && (
        <div className="absolute right-0 top-0 rounded-md border border-brand-hairline bg-white p-2 text-xs shadow">
          <div className="mb-1 font-semibold">{rows[hover].label}</div>
          {TYPES.filter((t) => rows[hover].parts[t]).map((t) => <div key={t} className="flex justify-between gap-4"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: COLORS[t] }} />{t}</span><span className="tabular-nums">R {money(rows[hover].parts[t])}</span></div>)}
        </div>
      )}
    </div>
  )
}
function Legend() {
  return <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">{TYPES.map((t) => <span key={t}><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COLORS[t] }} />{t}</span>)}</div>
}
