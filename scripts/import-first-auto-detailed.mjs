// Imports the First Auto "Detailed FA Report" (the fuel-card statement: Fuel Value, Oil Value, Toll Value, fees, odometer, litres).
//   node scripts/import-first-auto-detailed.mjs "<Detailed FA Report.xlsx>" --period YYYY-MM [--apply]
// Grand Total = the fuel-card debit order. Maintenance comes separately from the WesBank CI invoices (import-fa-maintenance.mjs).
// Staff cards: deduction = fuel + oil (excl); repairs/tyres on the fuel card (rare) → the person's accrual incl VAT (as with the CI invoices); toll and fees company cost.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { cardDeducts } from '../src/lib/rules.ts';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply'); const period = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
if (!file || !period) { console.error('usage: node scripts/import-first-auto-detailed.mjs <report.xlsx> --period YYYY-MM [--apply]'); process.exit(1); }
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; }; const r2 = (n) => Math.round(n * 100) / 100;
const CAT = { 0: 'Admin', 1: 'Ops Cabling', 2: 'Ops Admin', 3: 'Sales', 4: 'Exec' };
const wb = XLSX.read(readFileSync(file), { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const h = rows.findIndex((r) => r.map(normKey).includes('fuel value') && r.map(normKey).includes('reg num')); if (h < 0) { console.error('Not a Detailed FA Report (no Fuel Value / Reg Num columns)'); process.exit(1); }
const idx = new Map(); rows[h].forEach((c, i) => { const k = normKey(c); if (k && !idx.has(k)) idx.set(k, i); }); const c = (n) => idx.get(normKey(n)) ?? -1;
const col = { code: c('cost code'), name: c('cost name'), driver: c('driver'), reg: c('reg num'), make: c('make'), model: c('model'), odoO: c('opening odo'), odoC: c('closing odo'), span: c('span'), litres: c('litres'), fuel: c('fuel value'), oil: c('oil value'), rm: c('repair and maint'), tyres: c('tyre value'), acc: c('accident value'), other: c('other value'), toll: c('toll value'), fixed: c('fixed fee'), varf: c('var fee'), trans: c('trans fee'), mag: c('mag fee'), lost: c('lost card fee'), scr: c('invoice scr'), feeVat: c('vat on fees'), grand: c('grand total') };
const v = (r, i) => (i >= 0 ? toNum(r[i]) : 0); const nv = (r, i) => (i >= 0 && r[i] !== '' ? toNum(r[i]) : null); const split = (incl) => { const excl = r2(incl / 1.15); return { excl, vat: r2(incl - excl) }; };
const lines = [];
for (const r of rows.slice(h + 1)) {
  const reg = normReg(r[col.reg]); const driver = String(r[col.driver] ?? '').trim(); if (!reg && !driver) continue;
  const oil = split(v(r, col.oil)), rm = split(v(r, col.rm)), tyres = split(v(r, col.tyres)), acc = split(v(r, col.acc)), other = split(v(r, col.other)), toll = split(v(r, col.toll));
  const fees_excl = r2(v(r, col.fixed) + v(r, col.varf) + v(r, col.trans) + v(r, col.mag) + v(r, col.lost) + v(r, col.scr)); const fees_vat = v(r, col.feeVat);
  const expenses_excl = r2(v(r, col.fuel) + oil.excl + rm.excl + tyres.excl + acc.excl + other.excl + toll.excl); const expenses_vat = r2(oil.vat + rm.vat + tyres.vat + acc.vat + other.vat + toll.vat);
  lines.push({ period, fa_name_code: String(r[col.name] ?? '').trim(), fa_code: String(r[col.code] ?? '').trim(), fa_driver_name: driver, fa_reg: reg, make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
    fuel: v(r, col.fuel), oil_excl: oil.excl, oil_vat: oil.vat, repairs_excl: rm.excl, repairs_vat: rm.vat, tyres_excl: tyres.excl, tyres_vat: tyres.vat, accident_excl: acc.excl, accident_vat: acc.vat, maint_excl: 0, maint_vat: 0, overhaul_excl: 0, overhaul_vat: 0, other_excl: other.excl, other_vat: other.vat, toll_excl: toll.excl, toll_vat: toll.vat,
    expenses_excl, expenses_vat, fees_excl, fees_vat, grand_total: col.grand >= 0 ? v(r, col.grand) : r2(expenses_excl + expenses_vat + fees_excl + fees_vat), odo_close: nv(r, col.odoC), odo_prev: nv(r, col.odoO), kms: nv(r, col.span), litres: nv(r, col.litres), consumption: null });
}
const sum = (k) => r2(lines.reduce((s, l) => s + (Number(l[k]) || 0), 0));
console.log(`${basename(file)} → ${period}: ${lines.length} cards · fuel ${sum('fuel')} · oil+toll+other excl ${r2(sum('expenses_excl') - sum('fuel'))} · VAT ${sum('expenses_vat')} · fees ${sum('fees_excl')} + VAT ${sum('fees_vat')} · GRAND TOTAL (fuel-card debit order) ${sum('grand_total')} · km span ${sum('kms')}`);
const { createClient } = await import('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: cards }, { data: employees }, { data: vehicles }, { data: branches }] = await Promise.all([sb.from('fleet_cards').select('*'), sb.from('fleet_employees').select('*'), sb.from('fleet_vehicles').select('*'), sb.from('fleet_branches').select('*')]);
const ck = new Map(cards.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x])); const branchOf = (code) => branches.find((b) => b.code === code || (b.aliases ?? []).includes(code));
const owners = new Map(employees.filter((e) => e.vehicle_reg).map((e) => [normReg(e.vehicle_reg), e]));
const newCards = [];
for (const l of lines) { if (ck.has(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)) continue; const m = l.fa_name_code.match(/^(\d{4})-?\s*([A-Z0-9]{3})\b/); const cat = m ? CAT[m[1][3]] : null; const br = m ? branchOf(m[2]) : null; const owner = owners.get(l.fa_reg); const veh = !owner ? vehicles.find((x) => normReg(x.registration) === l.fa_reg) : null; const empNo = l.fa_driver_name.match(/^(\d{4})[-/]/)?.[1]; const emp = owner ?? (!veh && empNo ? employees.find((e) => e.emp_no === empNo) : null);
  newCards.push({ fa_driver_name: l.fa_driver_name, fa_reg: l.fa_reg, holder_type: emp ? 'staff' : veh ? 'vehicle' : 'unallocated', employee_id: emp?.id ?? null, vehicle_id: veh?.id ?? null, branch_id: br?.id ?? emp?.branch_id ?? veh?.branch_id ?? null, category: cat ?? emp?.category ?? veh?.category ?? null, notes: `Created from statement ${period}` }); }
if (newCards.length) console.log(`new cards: ${newCards.length}`, newCards.filter((x) => x.holder_type === 'unallocated').map((x) => `UNALLOCATED ${x.fa_driver_name} ${x.fa_reg}`).join('; '));
const staff = lines.filter((l) => { const cd = ck.get(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`); return cd?.holder_type === 'staff' && cd.employee_id && cardDeducts(cd, period); });
console.log(`staff deductions (fuel + oil excl): ${staff.length} cards R ${r2(staff.reduce((s, l) => s + l.fuel + l.oil_excl, 0))}`);
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
if (newCards.length) { const { error } = await sb.from('fleet_cards').upsert(newCards, { onConflict: 'fa_driver_name,fa_reg' }); if (error) throw error; }
const { data: cards2 } = await sb.from('fleet_cards').select('*'); const ck2 = new Map(cards2.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x]));
const { data: old } = await sb.from('fleet_imports').select('id').eq('source', 'first_auto').eq('period', period).is('provider', null);
for (const o of old ?? []) await sb.from('fleet_accrual_txns').delete().eq('import_id', o.id);
await sb.from('fleet_imports').delete().eq('source', 'first_auto').eq('period', period).is('provider', null);
const { data: imp, error: iErr } = await sb.from('fleet_imports').insert({ source: 'first_auto', period, file_name: basename(file), row_count: lines.length, total_amount: sum('grand_total'), notes: 'Detailed FA Report (fuel-card statement incl. fees & odometer); grand total = fuel-card debit order' }).select('id').single(); if (iErr) throw iErr;
const payload = lines.map((l) => ({ import_id: imp.id, card_id: ck2.get(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)?.id ?? null, ...l }));
for (let i = 0; i < payload.length; i += 500) { const { error } = await sb.from('fleet_fa_lines').insert(payload.slice(i, i + 500)); if (error) throw error; }
const { data: saved } = await sb.from('fleet_fa_lines').select('*').eq('import_id', imp.id); const dedRows = []; const txns = [];
for (const l of saved) { const cd = cards2.find((x) => x.id === l.card_id); if (!(cd?.holder_type === 'staff' && cd.employee_id && cardDeducts(cd, period))) continue; dedRows.push({ period, employee_id: cd.employee_id, card_id: cd.id, fa_line_id: l.id, amount: r2(Number(l.fuel) + Number(l.oil_excl)) });
  const maint = r2(['repairs','tyres','accident','maint','overhaul','other'].reduce((s, k) => s + Number(l[`${k}_excl`]) + Number(l[`${k}_vat`]), 0)); if (maint) txns.push({ employee_id: cd.employee_id, txn_date: `${period}-01`, period, kind: 'payout', amount: -maint, description: `Fleet card maintenance ${period} (bought on the fuel card, incl VAT)`, reference: `${l.fa_driver_name} ${l.fa_reg}`, import_id: imp.id }); }
await sb.from('fleet_deductions').delete().eq('period', period);
if (dedRows.length) { const { error } = await sb.from('fleet_deductions').insert(dedRows); if (error) throw error; }
if (txns.length) { const { error } = await sb.from('fleet_accrual_txns').insert(txns); if (error) throw error; }
console.log(`imported ${payload.length} cards R ${sum('grand_total')}; ${dedRows.length} deductions R ${r2(dedRows.reduce((s, d) => s + d.amount, 0))}; ${txns.length} fuel-card maintenance utilisations`);
