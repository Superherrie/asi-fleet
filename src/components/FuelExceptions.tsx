import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Masters } from '../hooks/useMasters'
import type { FaLine } from '../lib/types'
import { money, num, periodLabel, prevPeriod } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Card, Badge, Button } from './ui'

type Sev = 1 | 2 | 3
interface Flag { sev: Sev; text: string }
interface Row {
  key: string; reg: string; holder: string; costCentre: string; branch: string; vehicle: string; staff: boolean; tracker: string; driver: string
  fuel: number; litres: number; km: number; l100: number | null; kmDay: number; normKm: number | null; flags: Flag[]; score: number; kind: 'fuel' | 'log'
}
interface LogRow { employee_id: number; period: string; business_km: number; private_km: number }

/** Working days (Mon–Fri) in a period, used for the km-per-working-day test. */
const workingDays = (p: string) => { const [y, m] = p.split('-').map(Number); let n = 0; for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) { const w = new Date(y, m - 1, d).getDay(); if (w !== 0 && w !== 6) n++ } return n }
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null }
const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Monthly fuel exception report: fleet cards whose distance, litres or odometer do not add up.
 * The odometer on a First Auto statement is typed in at the pump, so a tidy litres-per-100km proves nothing on its own —
 * what these tests look for is volume no single vehicle plausibly does, a sudden break from the vehicle's own norm,
 * fuel with no odometer at all, and odometers that do not chain from one month to the next.
 */
export default function FuelExceptions({ m, period }: { m: Masters; period: string }) {
  const [lines, setLines] = useState<FaLine[] | null>(null); const [logs, setLogs] = useState<LogRow[]>([]); const [open, setOpen] = useState(true); const [showLow, setShowLow] = useState(false)
  const from = prevPeriod(period, 12)
  useEffect(() => {
    setLines(null)
    void Promise.all([
      supabase.from('fleet_fa_lines').select('*').gte('period', from).lte('period', period),
      supabase.from('fleet_travel_logs').select('employee_id,period,business_km,private_km').eq('period', period).neq('status', 'draft'),
    ]).then(([f, l]) => { setLines((f.data ?? []) as FaLine[]); setLogs((l.data ?? []) as LogRow[]) })
  }, [period, from])

  const rows = useMemo(() => {
    if (!lines) return []
    const cardOf = new Map(m.cards.map((c) => [c.id, c])); const vehOf = new Map(m.vehicles.map((v) => [v.id, v])); const wd = workingDays(period)
    const cur = lines.filter((l) => l.period === period && ((l.fuel || 0) > 0 || (l.litres || 0) > 0))
    // what is normal for each model across the fleet this month, and for each registration over its own history
    const byModel = new Map<string, number[]>()
    for (const l of cur) { const km = l.kms || 0, lit = l.litres || 0; if (km >= 300 && lit > 0) { const c = (lit / km) * 100; if (c > 3 && c < 40) { const k = `${l.make} ${l.model}`; byModel.set(k, [...(byModel.get(k) ?? []), c]) } } }
    const hist = new Map<string, number[]>()
    for (const l of lines) if (l.period < period && (l.kms || 0) > 0) { const k = norm(l.fa_reg); hist.set(k, [...(hist.get(k) ?? []), l.kms || 0]) }
    const prevMonth = prevPeriod(period)
    const out: Row[] = []
    for (const l of cur) {
      const card = l.card_id ? cardOf.get(l.card_id) : undefined; const v = card?.vehicle_id ? vehOf.get(card.vehicle_id) : undefined
      const staff = card?.holder_type === 'staff'; const km = l.kms || 0, lit = l.litres || 0; const l100 = km > 0 && lit > 0 ? (lit / km) * 100 : null
      const flags: Flag[] = []; const add = (sev: Sev, text: string) => flags.push({ sev, text })
      const h = hist.get(norm(l.fa_reg)) ?? []; const normKm = h.length >= 3 ? Math.round(h.reduce((a, b) => a + b, 0) / h.length) : null
      if (!staff) {
        if (km >= 6000) add(km >= 8000 ? 3 : 2, `${num(km)} km in the month — ${num(Math.round(km / wd))} km per working day`)
        if (normKm && km >= 4000 && km >= normKm * 2) add(2, `${(km / normKm).toFixed(1)}× its own average of ${num(normKm)} km a month`)
        if (lit >= 700) add(2, `${num(Math.round(lit))} litres on one card in the month`)
      }
      if (lit >= 150 && !km) add(lit >= 400 ? 3 : 2, `${num(Math.round(lit))} litres drawn with no odometer reading`)
      const med = median(byModel.get(`${l.make} ${l.model}`) ?? []); const nModel = (byModel.get(`${l.make} ${l.model}`) ?? []).length
      if (l100 != null && km >= 500 && med && nModel >= 3) {
        if (l100 >= med * 1.6) add(3, `${l100.toFixed(1)} l/100 km against ${med.toFixed(1)} for the same model — more fuel than the distance explains`)
        else if (l100 <= med * 0.6) add(2, `${l100.toFixed(1)} l/100 km against ${med.toFixed(1)} for the same model — odometer looks overstated`)
      }
      if (l.odo_close != null && l.odo_prev != null && l.odo_close < l.odo_prev) add(3, `odometer went backwards (${num(l.odo_prev)} → ${num(l.odo_close)})`)
      const before = lines.find((x) => x.period === prevMonth && x.card_id === l.card_id)
      if (before?.odo_close != null && l.odo_prev != null && Math.abs(before.odo_close - l.odo_prev) > 50) add(2, `odometer does not follow last month: closed ${num(before.odo_close)}, opened ${num(l.odo_prev)}`)
      let kind: Row['kind'] = 'fuel'
      if (staff && card?.employee_id) {
        const lg = logs.filter((x) => x.employee_id === card.employee_id); const logKm = lg.reduce((s, x) => s + (x.business_km || 0) + (x.private_km || 0), 0)
        if (logKm > 200 && km > logKm * 1.5 && km - logKm > 800) { add(2, `card shows ${num(km)} km, own travel log shows ${num(Math.round(logKm))} km — private km left off the log`); kind = flags.length === 1 ? 'log' : 'fuel' }
      }
      if (!flags.length) continue
      out.push({
        key: `${l.id}`, reg: l.fa_reg ?? '', holder: l.fa_driver_name ?? '', costCentre: l.fa_name_code ?? '', branch: v ? m.bm.code(v.branch_id) : card?.branch_id ? m.bm.code(card.branch_id) : '',
        vehicle: `${l.make ?? ''} ${l.model ?? ''}`.trim(), staff, tracker: v?.tracking_provider ?? (staff ? '' : 'none'), driver: v?.driver_name ?? '',
        fuel: l.fuel || 0, litres: lit, km, l100, kmDay: km ? Math.round(km / wd) : 0, normKm, flags, score: flags.reduce((s, f) => s + f.sev, 0), kind,
      })
    }
    return out.sort((a, b) => b.score - a.score || b.fuel - a.fuel)
  }, [lines, logs, m, period])

  if (!lines) return null
  const shown = rows.filter((r) => showLow || r.score >= 2)
  const fuelAtRisk = rows.filter((r) => r.kind === 'fuel' && r.score >= 3).reduce((s, r) => s + r.fuel, 0)
  const hasHistory = lines.some((l) => l.period < prevPeriod(period, 2))
  function exportXlsx() {
    const out: (string | number | null)[][] = [[`Fuel exception report — ${periodLabel(period)}`], [], ['Reg', 'Vehicle', 'Type', 'Card holder', 'Cost centre', 'Branch', 'Allocated driver', 'Tracker', 'Fuel R', 'Litres', 'km', 'l/100 km', 'km per working day', 'Own average km', 'Score', 'Exceptions']]
    for (const r of rows) out.push([r.reg, r.vehicle, r.staff ? 'staff private' : 'company', r.holder, r.costCentre, r.branch, r.driver, r.tracker, Math.round(r.fuel), Math.round(r.litres), r.km, r.l100 ? Math.round(r.l100 * 10) / 10 : null, r.kmDay, r.normKm, r.score, r.flags.map((f) => f.text).join(' | ')])
    downloadWorkbook([{ name: 'Fuel exceptions', rows: out, widths: [11, 28, 13, 26, 30, 8, 22, 16, 10, 8, 8, 9, 10, 10, 7, 110] }], `Fuel exceptions ${periodLabel(period)}.xlsx`)
  }
  return (
    <Card className="mb-4"
      title={<button type="button" className="text-left" onClick={() => setOpen((o) => !o)}>Fuel exception report — {periodLabel(period)}{rows.length > 0 && <span className="ml-2 rounded-full bg-brand-pink px-2 text-xs font-semibold text-white">{rows.filter((r) => r.score >= 3).length} to investigate</span>}<span className="ml-2 text-xs font-normal text-brand-purple">{open ? 'hide' : 'show'}</span></button>}
      actions={<div className="flex items-center gap-2"><label className="text-xs text-slate-500"><input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} /> include minor</label><Button size="sm" variant="secondary" onClick={exportXlsx} disabled={!rows.length}>Export</Button></div>}>
      {open && (rows.length === 0 ? <p className="text-sm text-slate-500">No exceptions on the {periodLabel(period)} First Auto statement.</p> : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            Cards whose distance, litres or odometer do not add up. The odometer is typed in at the pump, so a tidy consumption figure proves nothing; confirm each one against the tracker's actual distance for the month.
            {fuelAtRisk > 0 && <> Fuel on the cards marked to investigate: <b>R {money(fuelAtRisk)}</b>.</>} {!hasHistory && <> The “own average” test starts once three months of statements are loaded.</>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-brand-navy text-left text-xs uppercase tracking-wide text-white">{['Vehicle', 'Card holder', 'Branch', 'Tracker', 'Fuel', 'Litres', 'km', 'l/100', 'What does not add up'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-brand-hairline">
                {shown.map((r) => (
                  <tr key={r.key} className="align-top hover:bg-brand-card">
                    <td className="px-2 py-1"><div className="font-medium">{r.reg}</div><div className="text-xs text-slate-500">{r.vehicle}{r.staff && <span className="ml-1 text-brand-purple">· staff private car</span>}</div></td>
                    <td className="px-2 py-1 text-xs">{r.holder}<div className="text-slate-400">{r.costCentre}</div>{r.driver && <div className="text-slate-500">driver: {r.driver}</div>}</td>
                    <td className="px-2 py-1">{r.branch}</td>
                    <td className="px-2 py-1 text-xs">{r.staff ? '—' : r.tracker === 'none' ? <span className="text-amber-700">none</span> : r.tracker}</td>
                    <td className="num-cell whitespace-nowrap px-2 py-1 tabular-nums">{money(r.fuel)}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{num(Math.round(r.litres))}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{r.km ? num(r.km) : '–'}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{r.l100 ? r.l100.toFixed(1) : '–'}</td>
                    <td className="px-2 py-1"><ul className="space-y-0.5">{r.flags.map((f, i) => <li key={i} className="flex gap-1.5 text-xs"><Badge tone={f.sev === 3 ? 'red' : f.sev === 2 ? 'amber' : 'slate'}>{f.sev === 3 ? 'investigate' : f.sev === 2 ? 'check' : 'note'}</Badge><span>{f.text}</span></li>)}</ul>{r.kind === 'log' && <div className="mt-0.5 text-[11px] text-slate-500">Staff card fuel is recovered from salary, so this is a logbook issue, not a company loss.</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </Card>
  )
}
