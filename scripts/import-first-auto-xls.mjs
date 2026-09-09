// Imports the First Auto "Monthly Cost Report" / Combined Statement workbook (the layout the accountant journals from:
// Name, Code, Driver Name, Reg Num, Make, Model, Seq, Fuel Mth SUM, Oil Vat/Excl, Repairs Vat/Excl, Tyres, Accident, Maint Serv,
// Overhaul, Other, Toll, Total Expenses Vat/Excl, FIXED FEE … VAT FEES LEVIED, TOTAL FEES, GRAND TOTAL, Odo Close/Prev, Kms …).
//   node scripts/import-first-auto-xls.mjs "<Combined Statement.xlsx>" [--period YYYY-MM] [--apply]
// Grand total = the First Auto debit order. Staff cards: deduction = fuel + oil (excl); repairs/tyres/maint/other on a staff
// card are set off against the person's maintenance accrual (excl); toll and card fees are company cost.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { cardDeducts } from '../src/lib/rules.ts';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply');
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; }; const r2 = (n) => Math.round(n * 100) / 100;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const CAT = { 0: 'Admin', 1: 'Ops Cabling', 2: 'Ops Admin', 3: 'Sales', 4: 'Exec' };

// "UsageVAT" CSV exports wrap each data line in one pair of quotes with inner quotes doubled — unwrap before parsing
const unwrapCsv = (text) => { const ls = text.split(/\r?\n/); const wrapped = ls.filter((l) => l.length > 2).every((l, i) => i === 0 || (l.startsWith('"') && l.endsWith('"') && l.includes('""'))); return wrapped ? ls.map((l, i) => (i && l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1).replace(/""/g, '"') : l)).join('\n') : text; };
const wb = /\.csv$/i.test(file) ? XLSX.read(unwrapCsv(readFileSync(file, 'utf8')), { type: 'string', raw: true }) : XLSX.read(readFileSync(file), { type: 'buffer' });
let rows, h = -1; for (const n of wb.SheetNames) { rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }); h = rows.findIndex((r) => r.map(normKey).includes('driver name') && r.map(normKey).includes('reg num')); if (h >= 0) break; }
if (h < 0) { console.error('No First Auto header (Driver Name / Reg Num) found'); process.exit(1); }
let period = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
for (const r of rows.slice(0, h)) for (const c of r) { const m = String(c).match(/Monthend Date:\s*([A-Za-z]+)\.?\s+(\d{4})/i); if (m && MONTHS[m[1].toLowerCase()]) period ??= `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}`; }
const idx = new Map(); rows[h].forEach((c, i) => { const k = normKey(c); if (k && !idx.has(k)) idx.set(k, i); }); const c = (...n) => { for (const x of n) { const i = idx.get(normKey(x)); if (i != null) return i; } return -1; };
if (!period && c('monthend date') >= 0) { const m = String(rows[h + 1]?.[c('monthend date')] ?? '').match(/^(\d{4})-(\d{2})/); if (m) period = `${m[1]}-${m[2]}`; }
if (!period) { console.error('No "Monthend Date" — pass --period YYYY-MM'); process.exit(1); }
const col = { name: c('name'), code: c('code'), driver: c('driver name'), reg: c('reg num'), make: c('make'), model: c('model'), fuel: c('fuel mth sum'), oil_v: c('oil vat'), oil_x: c('oil excl vat'), rep_v: c('repairs vat'), rep_x: c('repairs excl vat', 'repiars excl vat'), tyr_v: c('tyres vat'), tyr_x: c('tyres excl vat'), acc_v: c('accident vat'), acc_x: c('accident excl vat'), mnt_v: c('maint serv vat', 'maint vat'), mnt_x: c('maint excl vat'), ovh_v: c('overhaul vat'), ovh_x: c('overhaul excl vat'), oth_v: c('other vat'), oth_x: c('other excl vat'), toll_v: c('toll vat'), toll_x: c('toll excl vat'), exp_v: c('total expenses vat'), exp_x: c('total expenses excl vat'), fee_fixed: c('fixed fee'), fee_lost: c('fee lost card sum'), fee_int: c('fee interest sum'), fee_mag: c('fee magnetic media sum'), fee_txn: c('transaction fee'), fee_scr: c('fee inv scrutiny sum'), fee_vat: c('vat fees levied'), fee_tot: c('total fees'), lost_j: c('lost card journal sum 1'), grand: c('grand total'), odo_c: c('odo close this mth'), litres: c('litre total sum'), odo_p: c('odo prev mth num', 'odo prev mth sum'), kms: c('kms'), cons: c('consump med mth sum') };
const v = (r, i) => (i >= 0 ? toNum(r[i]) : 0); const nv = (r, i) => (i >= 0 && r[i] !== '' ? toNum(r[i]) : null);
const lines = [];
for (const r of rows.slice(h + 1)) {
  const reg = normReg(r[col.reg]); const driver = String(r[col.driver] ?? '').trim(); if (!reg && !driver) continue; if (/^total/i.test(String(r[col.name] ?? ''))) continue;
  // Fuel-card part only: maintenance columns + the Inv Scrutiny fee are the WesBank CI invoices (imported separately as fa_maintenance)
  const ciPart = v(r, col.fee_scr) + [col.rep_x, col.tyr_x, col.acc_x, col.mnt_x, col.ovh_x, col.oth_x].reduce((s, i) => s + v(r, i), 0);
  const fees_excl = r2([col.fee_fixed, col.fee_lost, col.fee_int, col.fee_mag, col.fee_txn, col.lost_j].reduce((s, i) => s + v(r, i), 0));
  const fees_vat = ciPart ? r2((v(r, col.fee_fixed) + v(r, col.fee_mag) + v(r, col.fee_txn) + v(r, col.lost_j)) * 0.15) : v(r, col.fee_vat);
  const expenses_excl = r2(v(r, col.fuel) + v(r, col.oil_x) + v(r, col.toll_x)); const expenses_vat = r2(v(r, col.oil_v) + v(r, col.toll_v));
  const grand_total = !ciPart && col.grand >= 0 ? v(r, col.grand) : r2(expenses_excl + expenses_vat + fees_excl + fees_vat);
  const odo_close = nv(r, col.odo_c), odo_prev = nv(r, col.odo_p); const kms = col.kms >= 0 ? nv(r, col.kms) : odo_close && odo_prev ? odo_close - odo_prev : null;
  lines.push({ period, fa_name_code: String(r[col.name] ?? '').trim(), fa_code: String(r[col.code] ?? '').trim(), fa_driver_name: driver, fa_reg: reg, make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
    fuel: v(r, col.fuel), oil_excl: v(r, col.oil_x), oil_vat: v(r, col.oil_v), repairs_excl: 0, repairs_vat: 0, tyres_excl: 0, tyres_vat: 0, accident_excl: 0, accident_vat: 0,
    maint_excl: 0, maint_vat: 0, overhaul_excl: 0, overhaul_vat: 0, other_excl: 0, other_vat: 0, toll_excl: v(r, col.toll_x), toll_vat: v(r, col.toll_v),
    expenses_excl, expenses_vat, fees_excl, fees_vat, grand_total: r2(grand_total), odo_close, odo_prev, kms, litres: nv(r, col.litres), consumption: nv(r, col.cons) });
}
const sum = (k) => r2(lines.reduce((s, l) => s + (Number(l[k]) || 0), 0));
console.log(`${basename(file)} → ${period}: ${lines.length} lines · fuel ${sum('fuel')} · expenses excl ${sum('expenses_excl')} · VAT ${sum('expenses_vat')} · fees ${sum('fees_excl')} + VAT ${sum('fees_vat')} · GRAND TOTAL (debit order) ${sum('grand_total')}`);

const { createClient } = await import('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: cards }, { data: employees }, { data: vehicles }, { data: branches }] = await Promise.all([sb.from('fleet_cards').select('*'), sb.from('fleet_employees').select('*'), sb.from('fleet_vehicles').select('*'), sb.from('fleet_branches').select('*')]);
const ck = new Map(cards.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x])); const branchOf = (code) => branches.find((b) => b.code === code || (b.aliases ?? []).includes(code));
const owners = new Map(employees.filter((e) => e.vehicle_reg).map((e) => [normReg(e.vehicle_reg), e]));
const newCards = [];
for (const l of lines) {
  if (ck.has(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)) continue;
  const m = l.fa_name_code.match(/^(\d{4})-?\s*([A-Z0-9]{3})\b/); const cat = m ? CAT[m[1][3]] : null; const br = m ? branchOf(m[2]) : null;
  const owner = owners.get(l.fa_reg); const veh = !owner ? vehicles.find((x) => normReg(x.registration) === l.fa_reg) : null; const empNo = l.fa_driver_name.match(/^(\d{4})[-/]/)?.[1]; const emp = owner ?? (!veh && empNo ? employees.find((e) => e.emp_no === empNo) : null);
  newCards.push({ fa_driver_name: l.fa_driver_name, fa_reg: l.fa_reg, holder_type: emp ? 'staff' : veh ? 'vehicle' : 'unallocated', employee_id: emp?.id ?? null, vehicle_id: veh?.id ?? null, branch_id: br?.id ?? emp?.branch_id ?? veh?.branch_id ?? null, category: cat ?? emp?.category ?? veh?.category ?? null, notes: `Created from statement ${period}` });
}
if (newCards.length) console.log(`new cards: ${newCards.length}`, newCards.filter((x) => x.holder_type === 'unallocated').map((x) => `UNALLOCATED ${x.fa_driver_name} ${x.fa_reg}`).join('; '));
// staff deductions preview (fuel + oil excl) and staff-card maintenance → accrual
const staffKey = (l) => ck.get(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`);
const ded = lines.filter((l) => { const cd = staffKey(l); return cd?.holder_type === 'staff' && cd.employee_id && cardDeducts(cd, period); });
console.log(`staff deductions (fuel + oil excl): ${ded.length} cards R ${r2(ded.reduce((s, l) => s + l.fuel + l.oil_excl, 0))} · staff-card maintenance to accruals R ${r2(ded.reduce((s, l) => s + l.repairs_excl + l.tyres_excl + l.accident_excl + l.maint_excl + l.overhaul_excl + l.other_excl, 0))}`);
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }

if (newCards.length) { const { error } = await sb.from('fleet_cards').upsert(newCards, { onConflict: 'fa_driver_name,fa_reg' }); if (error) throw error; }
const { data: cards2 } = await sb.from('fleet_cards').select('*'); const ck2 = new Map(cards2.map((x) => [`${x.fa_driver_name.trim().toUpperCase()}|${normReg(x.fa_reg)}`, x]));
// replace: the earlier import (CSV) of this month goes, and with it its deductions and accrual utilisations
const { data: old } = await sb.from('fleet_imports').select('id').eq('source', 'first_auto').eq('period', period).is('provider', null);
for (const o of old ?? []) await sb.from('fleet_accrual_txns').delete().eq('import_id', o.id);
await sb.from('fleet_imports').delete().eq('source', 'first_auto').eq('period', period).is('provider', null);
const { data: imp, error: iErr } = await sb.from('fleet_imports').insert({ source: 'first_auto', period, file_name: basename(file), row_count: lines.length, total_amount: sum('grand_total'), notes: 'Fuel-card statement (UsageVAT / Combined layout, fuel-card part only) — VAT + card fees included; grand total = debit order' }).select('id').single(); if (iErr) throw iErr;
const payload = lines.map((l) => ({ import_id: imp.id, card_id: ck2.get(`${l.fa_driver_name.toUpperCase()}|${l.fa_reg}`)?.id ?? null, ...l }));
for (let i = 0; i < payload.length; i += 500) { const { error } = await sb.from('fleet_fa_lines').insert(payload.slice(i, i + 500)); if (error) throw error; }
const { data: saved } = await sb.from('fleet_fa_lines').select('*').eq('import_id', imp.id);
const dedRows = []; const txns = [];
for (const l of saved) { const cd = cards2.find((x) => x.id === l.card_id); if (!(cd?.holder_type === 'staff' && cd.employee_id && cardDeducts(cd, period))) continue;
  dedRows.push({ period, employee_id: cd.employee_id, card_id: cd.id, fa_line_id: l.id, amount: r2(Number(l.fuel) + Number(l.oil_excl)) });
  const maint = r2(Number(l.repairs_excl) + Number(l.tyres_excl) + Number(l.accident_excl) + Number(l.maint_excl) + Number(l.overhaul_excl) + Number(l.other_excl));
  if (maint) txns.push({ employee_id: cd.employee_id, txn_date: `${period}-01`, period, kind: 'payout', amount: -maint, description: `Fleet card maintenance ${period} (repairs/tyres/service on own vehicle, excl VAT)`, reference: `${l.fa_driver_name} ${l.fa_reg}`, import_id: imp.id }); }
await sb.from('fleet_deductions').delete().eq('period', period);
if (dedRows.length) { const { error } = await sb.from('fleet_deductions').insert(dedRows); if (error) throw error; }
if (txns.length) { const { error } = await sb.from('fleet_accrual_txns').insert(txns); if (error) throw error; }
console.log(`imported ${payload.length} lines R ${sum('grand_total')}; ${dedRows.length} deductions R ${r2(dedRows.reduce((s, d) => s + d.amount, 0))}; ${txns.length} maintenance utilisations R ${r2(-txns.reduce((s, t) => s + t.amount, 0))}`);
