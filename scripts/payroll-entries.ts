// Writes the monthly "Payroll Entries" workbook (same as Payroll → "Download payroll entries" in the app).
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/payroll-entries.ts 2026-09 ["<output folder>"]
import fs from 'node:fs'; import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildPayrollWorkbook, type PayrollRow } from '../src/lib/payrollSheet'
import { periodLabel, prevPeriod, round2, num } from '../src/lib/format'

for (const l of fs.readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim() }
const period = process.argv[2]; if (!/^\d{4}-\d{2}$/.test(period ?? '')) { console.error('usage: payroll-entries.ts YYYY-MM [folder]'); process.exit(1) }
const outDir = process.argv[3] ?? 'C:/Users/User1/OneDrive - Herman/OneDrive - Conekt Business Group/Desktop/Claude/Fleet/Output'
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
type Claim = { id: number; period: string; employee_id: number; log_id: number | null; business_km: number; fuel_rate: number; maint_rate: number; fuel_amount: number; maint_amount: number; total_amount: number }
type Emp = { id: number; emp_no: string | null; full_name: string; category: string; branch_id: number | null; active: boolean; fuel_rate: number | null; maint_rate: number | null }
const [emps, branches, ded, claims, late, logs] = await Promise.all([
  s.from('fleet_employees').select('*'), s.from('fleet_branches').select('id,name'),
  s.from('fleet_deductions').select('employee_id,amount').eq('period', period),
  s.from('fleet_claims').select('*').eq('period', period),
  s.from('fleet_claims').select('*').lt('period', period).eq('status', 'pending').gt('total_amount', 0),
  s.from('fleet_travel_logs').select('id,employee_id,vehicle_kind,vehicle_reg').eq('period', period),
])
const employees = emps.data as Emp[]; const bname = new Map((branches.data ?? []).map((b: { id: number; name: string }) => [b.id, b.name]))
const empOf = (id: number) => employees.find((e) => e.id === id)
const dept = (c: string) => (c === 'Exec' ? 'Directors' : c)
const payLabel = periodLabel(prevPeriod(period, -1))
const toRow = (e: Emp, fa: number, c: Claim | null, lateClaim = false): PayrollRow => ({
  emp_no: e.emp_no ?? '', name: e.full_name, department: dept(e.category), branch: bname.get(e.branch_id ?? -1) ?? '',
  fa_deduction: round2(fa), reimbursement: c?.fuel_amount ?? 0, provision: c?.maint_amount ?? 0, business_km: c?.business_km ?? 0,
  fuel_rate: c?.fuel_rate ?? e.fuel_rate, maint_rate: c?.maint_rate ?? e.maint_rate,
  note: lateClaim ? `late claim — ${periodLabel(c!.period)} log` : !c ? 'no travel log received' : !c.fuel_rate && !c.maint_rate ? 'no rate on file — claim not calculated' : '',
})
const people = new Map<number, { fa: number; c: Claim | null }>()
for (const d of ded.data ?? []) { const p = people.get(d.employee_id) ?? { fa: 0, c: null }; p.fa = round2(p.fa + Number(d.amount)); people.set(d.employee_id, p) }
const split = new Map<number, string[]>()
const logKind = new Map((logs.data ?? []).map((l: { id: number; vehicle_kind: string; vehicle_reg: string }) => [l.id, l]))
const kindOf = (c: Claim) => logKind.get(c.log_id ?? -1)?.vehicle_kind ?? 'own'
for (const c of ([...(claims.data ?? [])] as Claim[]).sort((a, b) => (kindOf(a) === 'own' ? 0 : 1) - (kindOf(b) === 'own' ? 0 : 1) || a.id - b.id)) {
  const p = people.get(c.employee_id) ?? { fa: 0, c: null }
  const lg = logKind.get(c.log_id ?? -1); const kind = lg?.vehicle_kind ?? 'own'
  const part = `${lg?.vehicle_reg ?? ''} ${kind === 'rental' ? 'rental' : kind === 'second' ? 'second car' : 'own car'}: ${num(c.business_km, 1)} km × ${num(c.fuel_rate, 2)} fuel${c.maint_rate ? ` + ${num(c.maint_rate, 2)} maint` : ' (no maintenance on a rental)'} = ${num(c.total_amount, 2)}`
  split.set(c.employee_id, [...(split.get(c.employee_id) ?? []), part])
  p.c = p.c ? { ...p.c, business_km: p.c.business_km + c.business_km, fuel_amount: round2(p.c.fuel_amount + c.fuel_amount), maint_amount: round2(p.c.maint_amount + c.maint_amount), total_amount: round2(p.c.total_amount + c.total_amount) } : c
  people.set(c.employee_id, p)
}
for (const e of employees) if (e.active && (e.fuel_rate || e.maint_rate) && !people.has(e.id)) people.set(e.id, { fa: 0, c: null })
const list = [...people.entries()].map(([id, p]) => ({ e: empOf(id), ...p })).filter((x) => x.e).sort((a, b) => (a.e!.emp_no ?? '').localeCompare(b.e!.emp_no ?? ''))
const withSplit = (r: PayrollRow, id: number) => { const sp = split.get(id); return sp && sp.length > 1 ? { ...r, note: [r.note, `two logs — ${sp.join('; ')}`].filter(Boolean).join('; ') } : r }
const rows = list.map(({ e, fa, c }) => withSplit(toRow(e!, fa, c), e!.id))
const lateRows = (late.data as Claim[]).map((c) => { const e = empOf(c.employee_id); return e ? toRow(e, 0, c, true) : null }).filter((x): x is PayrollRow => !!x)
const wb = buildPayrollWorkbook({ periodLabel: periodLabel(period), payLabel, rows, lateRows })
const file = path.join(outDir, `Payroll Entries for ${periodLabel(period)}.xlsx`)
await wb.xlsx.writeFile(file)
console.log('written', file, '|', rows.length, 'people,', lateRows.length, 'late')
for (const r of rows.filter((r) => r.note.includes('two logs') || /Lepota/.test(r.name))) console.log(r.emp_no, r.name, r.business_km, r.reimbursement, r.provision, r.fuel_rate, r.maint_rate, '|', r.note)
console.log('totals: FA', round2(rows.reduce((a, r) => a + r.fa_deduction, 0)), 'reim', round2(rows.reduce((a, r) => a + r.reimbursement, 0)), 'prov', round2(rows.reduce((a, r) => a + r.provision, 0)))
