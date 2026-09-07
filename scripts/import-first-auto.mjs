// Imports a First Auto monthly statement (the CSV export: "Cost Name, Reg Num, Driver Name, ... Fuel Month ... Direct Var Cost Month ... Toll Month")
// into fleet_imports + fleet_fa_lines, creates unseen cards, and prepares staff salary deductions.
//   node scripts/import-first-auto.mjs "<August Statement.csv>" [--period 2026-08] [--apply]
// Deduction = Direct Var Cost Month (fuel + oil + maint + repairs + tyres + overhaul + exchanges) — matches payroll's July sheet. Toll is NOT deducted.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply');
if (!file) { console.error('usage: node scripts/import-first-auto.mjs <statement.csv|xls> [--period YYYY-MM] [--apply]'); process.exit(1); }
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };
const r2 = (n) => Math.round(n * 100) / 100;
const CAT = { 0: 'Admin', 1: 'Ops Cabling', 2: 'Ops Admin', 3: 'Sales', 4: 'Exec' };

const wb = XLSX.read(readFileSync(file), { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const idx = new Map(rows[0].map((h, i) => [normKey(h), i])); const c = (...n) => { for (const x of n) { const i = idx.get(normKey(x)); if (i != null) return i; } return -1; };
const col = { name: c('cost name', 'name'), reg: c('reg num'), driver: c('driver name'), me: c('month end date'), make: c('make'), model: c('model'), km: c('kms span month', 'kms'), litres: c('litre_actual_mth', 'litre total sum'), cons: c('fuel_consump_actual'),
  fuel: c('fuel month', 'fuel mth sum'), oil: c('oil month'), maint: c('maint services month'), repairs: c('repairs month'), tyres: c('tyres month'), overhaul: c('overhaul month'), exch: c('exchanges month'), dv: c('direct var cost month'), toll: c('toll month') };
if (col.driver < 0 || col.reg < 0) { console.error('Not a First Auto statement (no Driver Name / Reg Num columns)'); process.exit(1); }
const v = (r, i) => (i >= 0 ? toNum(r[i]) : 0);
let period = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
if (!period && col.me >= 0) { const me = rows[1]?.[col.me]; const d = typeof me === 'number' ? new Date(Math.round((me - 25569) * 86400000)) : new Date(String(me)); if (!isNaN(d)) period = d.toISOString().slice(0, 7); }
if (!period) { console.error('Could not determine the period — pass --period YYYY-MM'); process.exit(1); }

const lines = rows.slice(1).filter((r) => r[col.reg] || r[col.driver]).map((r) => {
  const other = v(r, col.exch); const dv = col.dv >= 0 ? v(r, col.dv) : v(r, col.fuel) + v(r, col.oil) + v(r, col.maint) + v(r, col.repairs) + v(r, col.tyres) + v(r, col.overhaul) + other;
  return { period, fa_name_code: String(r[col.name]).trim(), fa_code: null, fa_driver_name: String(r[col.driver]).trim(), fa_reg: normReg(r[col.reg]), make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
    fuel: v(r, col.fuel), oil_excl: v(r, col.oil), repairs_excl: v(r, col.repairs), tyres_excl: v(r, col.tyres), maint_excl: v(r, col.maint), overhaul_excl: v(r, col.overhaul), other_excl: other, toll_excl: v(r, col.toll),
    expenses_excl: r2(dv + v(r, col.toll)), expenses_vat: 0, fees_excl: 0, fees_vat: 0, grand_total: r2(dv + v(r, col.toll)), direct_var: r2(dv),
    kms: col.km >= 0 && r[col.km] !== '' ? toNum(r[col.km]) : null, litres: col.litres >= 0 && r[col.litres] !== '' ? toNum(r[col.litres]) : null, consumption: col.cons >= 0 && r[col.cons] !== '' ? toNum(r[col.cons]) : null };
});
const total = r2(lines.reduce((s, l) => s + l.grand_total, 0));
console.log(`${basename(file)} → ${period}: ${lines.length} lines, R ${total} (direct var R ${r2(lines.reduce((s, l) => s + l.direct_var, 0))}, toll R ${r2(lines.reduce((s, l) => s + l.toll_excl, 0))})`);

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: cards }, { data: employees }, { data: vehicles }, { data: branches }] = await Promise.all([sb.from('fleet_cards').select('*'), sb.from('fleet_employees').select('*'), sb.from('fleet_vehicles').select('*'), sb.from('fleet_branches').select('*')]);
const ck = new Map(cards.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x]));
const branchOf = (code) => branches.find((b) => b.code === code || (b.aliases ?? []).includes(code));
const newCards = [];
for (const l of lines) {
  if (ck.has(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)) continue;
  const m = l.fa_name_code.match(/^(\d{4})-?\s*([A-Z0-9]{3})\b/); const cat = m ? CAT[m[1][3]] : null; const br = m ? branchOf(m[2]) : null;
  // a reg on the fleet master is a company vehicle even when First Auto shows a named driver ("1740-STEFANUS KOEN"); otherwise the emp-no prefix means a staff card
  const veh = vehicles.find((x) => normReg(x.registration) === l.fa_reg); const empNo = l.fa_driver_name.match(/^(\d{4})[-/]/)?.[1]; const emp = !veh && empNo ? employees.find((e) => e.emp_no === empNo) : null;
  newCards.push({ fa_driver_name: l.fa_driver_name, fa_reg: l.fa_reg, holder_type: veh ? 'vehicle' : emp ? 'staff' : 'unallocated', employee_id: emp?.id ?? null, vehicle_id: veh?.id ?? null, branch_id: br?.id ?? emp?.branch_id ?? veh?.branch_id ?? null, category: cat ?? emp?.category ?? veh?.category ?? null, notes: `Created from statement ${period}${!veh && !emp ? ` — cost code ${l.fa_name_code}` : ''}` });
}
console.log(`new cards: ${newCards.length} (${newCards.filter((x) => x.holder_type === 'unallocated').length} unallocated)`); newCards.filter((x) => x.holder_type === 'unallocated').forEach((x) => console.log('  UNALLOCATED', x.fa_driver_name, x.fa_reg));
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }

if (newCards.length) { const { error } = await sb.from('fleet_cards').upsert(newCards, { onConflict: 'fa_driver_name,fa_reg' }); if (error) throw error; }
const { data: cards2 } = await sb.from('fleet_cards').select('*'); const ck2 = new Map(cards2.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x]));
await sb.from('fleet_imports').delete().eq('source', 'first_auto').eq('period', period).is('provider', null);
const { data: imp, error: iErr } = await sb.from('fleet_imports').insert({ source: 'first_auto', period, file_name: basename(file), row_count: lines.length, total_amount: total, notes: 'CSV statement layout; deduction = Direct Var Cost Month (toll excluded)' }).select('id').single(); if (iErr) throw iErr;
const payload = lines.map(({ direct_var, ...l }) => ({ import_id: imp.id, card_id: ck2.get(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)?.id ?? null, ...l }));
for (let i = 0; i < payload.length; i += 500) { const { error } = await sb.from('fleet_fa_lines').insert(payload.slice(i, i + 500)); if (error) throw error; }
const { data: saved } = await sb.from('fleet_fa_lines').select('id,card_id,grand_total,toll_excl').eq('import_id', imp.id);
const ded = saved.map((l) => { const cd = cards2.find((x) => x.id === l.card_id); return cd?.holder_type === 'staff' && cd.employee_id ? { period, employee_id: cd.employee_id, card_id: cd.id, fa_line_id: l.id, amount: r2(l.grand_total - l.toll_excl) } : null; }).filter(Boolean);
await sb.from('fleet_deductions').delete().eq('period', period);
if (ded.length) { const { error } = await sb.from('fleet_deductions').insert(ded); if (error) throw error; }
console.log(`imported ${payload.length} lines; ${ded.length} staff deductions R ${r2(ded.reduce((s, d) => s + d.amount, 0))}`);
