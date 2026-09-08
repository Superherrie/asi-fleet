// Imports First Auto consolidated maintenance invoices (CI workbooks) into fleet_maint_lines and sets staff-vehicle
// work off against each person's maintenance accrual (fleet_accrual_txns kind 'payout').
//   node scripts/import-fa-maintenance.mjs "<file.xlsx>" [...more files] [--period YYYY-MM] [--apply]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { parseMaintenanceRows, isMaintenanceWork } from '../src/lib/maintenance.ts';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--period'); const APPLY = args.includes('--apply');
const forced = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const r2 = (n) => Math.round(n * 100) / 100;
const CAT = { 0: 'Admin', 1: 'Ops Cabling', 2: 'Ops Admin', 3: 'Sales', 4: 'Exec' };

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: emps }, { data: cards }, { data: vehicles }, { data: branches }] = await Promise.all([sb.from('fleet_employees').select('*'), sb.from('fleet_cards').select('*'), sb.from('fleet_vehicles').select('*'), sb.from('fleet_branches').select('*')]);
const ownerByReg = new Map(); emps.filter((e) => e.vehicle_reg).forEach((e) => ownerByReg.set(normReg(e.vehicle_reg), e));
const staffCardByReg = new Map(); cards.filter((c) => c.holder_type === 'staff' && c.employee_id).forEach((c) => staffCardByReg.set(normReg(c.fa_reg), c));
const vehByReg = new Map(vehicles.map((v) => [normReg(v.registration), v]));
const branchOf = (code) => branches.find((b) => b.code === code || (b.aliases ?? []).includes(code)) ?? null;
const classify = (r) => {
  const m = r.cost_centre.match(/^(\d{4})-?\s*([A-Z0-9]{3})\b/); const cat = m ? CAT[m[1][3]] : null; const br = m ? branchOf(m[2]) : null;
  const emp = ownerByReg.get(r.reg) ?? (staffCardByReg.get(r.reg) ? emps.find((e) => e.id === staffCardByReg.get(r.reg).employee_id) : null);
  const veh = !emp ? vehByReg.get(r.reg) : null; const card = staffCardByReg.get(r.reg) ?? cards.find((c) => c.holder_type === 'vehicle' && normReg(c.fa_reg) === r.reg) ?? null;
  return { employee_id: emp?.id ?? null, vehicle_id: veh?.id ?? null, card_id: card?.id ?? null, branch_id: br?.id ?? emp?.branch_id ?? veh?.branch_id ?? null, category: cat ?? emp?.category ?? veh?.category ?? null, emp, veh };
};

const parsed = [];
for (const f of files) {
  let wb; try { wb = XLSX.read(readFileSync(f), { type: 'buffer' }); } catch (e) { console.log(`✗ ${basename(f)}: ${e.message}`); continue; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Data ?? wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const p = parseMaintenanceRows(rows); const period = forced ?? p.period;
  const lines = p.rows.map((r) => ({ ...r, ...classify(r) }));
  const staffWork = lines.filter((l) => l.employee_id && isMaintenanceWork(l.billing_type)); const unknown = [...new Set(lines.filter((l) => !l.employee_id && !l.vehicle_id).map((l) => l.reg))];
  console.log(`${basename(f)} → ${period}: ${p.invoices.join(',')} ${lines.length} lines, excl ${p.totals.excl} vat ${p.totals.vat} total ${p.totals.total}`);
  console.log(`   staff-vehicle work (to accruals): ${staffWork.length} lines R ${r2(staffWork.reduce((s, l) => s + l.total, 0))} across ${new Set(staffWork.map((l) => l.employee_id)).size} people; company-vehicle work R ${r2(lines.filter((l) => l.vehicle_id && isMaintenanceWork(l.billing_type)).reduce((s, l) => s + l.total, 0))}; fees/interest R ${r2(lines.filter((l) => !isMaintenanceWork(l.billing_type)).reduce((s, l) => s + l.total, 0))}`);
  if (unknown.length) console.log(`   regs not matched to a person or fleet vehicle: ${unknown.join(', ')}`);
  const byEmp = new Map(); staffWork.forEach((l) => byEmp.set(l.emp.full_name, r2((byEmp.get(l.emp.full_name) ?? 0) + l.total)));
  [...byEmp].sort((a, b) => b[1] - a[1]).forEach(([n, v]) => console.log(`     ${n.padEnd(28)} R ${v}`));
  parsed.push({ file: basename(f), period, invoices: p.invoices, lines, totals: p.totals });
}
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
for (const p of parsed) {
  if (!p.period) { console.log(`skip ${p.file}: no period`); continue; }
  // replace an earlier import of the same invoice(s): drop their accrual payouts + lines via cascade
  const { data: old } = await sb.from('fleet_maint_lines').select('import_id').in('invoice_no', p.invoices); const oldImports = [...new Set((old ?? []).map((x) => x.import_id))];
  if (oldImports.length) { await sb.from('fleet_accrual_txns').delete().in('import_id', oldImports); await sb.from('fleet_imports').delete().in('id', oldImports); }
  const { data: imp, error } = await sb.from('fleet_imports').insert({ source: 'fa_maintenance', period: p.period, provider: p.invoices.join(','), file_name: p.file, row_count: p.lines.length, total_amount: p.totals.total, notes: 'First Auto managed-maintenance charge-back' }).select('id').single(); if (error) throw error;
  const payload = p.lines.map(({ emp, veh, ...l }) => ({ import_id: imp.id, period: p.period, ...l }));
  for (let i = 0; i < payload.length; i += 500) { const { error: e } = await sb.from('fleet_maint_lines').insert(payload.slice(i, i + 500)); if (e) throw e; }
  const { data: saved } = await sb.from('fleet_maint_lines').select('id,line_id,employee_id,total,supplier,item_desc,invoice_no,order_id,completion_date,order_date,billing_type').eq('import_id', imp.id);
  const txns = saved.filter((l) => l.employee_id && isMaintenanceWork(l.billing_type)).map((l) => ({ employee_id: l.employee_id, txn_date: l.completion_date ?? l.order_date ?? `${p.period}-01`, period: p.period, kind: 'payout', amount: -Number(l.total), description: `${l.supplier ?? 'Maintenance'} — ${l.item_desc ?? ''}`.slice(0, 200), reference: `${l.invoice_no}/${l.order_id ?? l.line_id}`, import_id: imp.id, maint_line_id: l.id }));
  for (let i = 0; i < txns.length; i += 500) { const { error: e } = await sb.from('fleet_accrual_txns').insert(txns.slice(i, i + 500)); if (e) throw e; }
  console.log(`imported ${p.file}: ${payload.length} lines; ${txns.length} accrual utilisations R ${r2(-txns.reduce((s, t) => s + t.amount, 0))}`);
}
