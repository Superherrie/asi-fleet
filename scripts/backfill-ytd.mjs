// Backfills history from the "YTD Running Cost Fleet" workbook so the dashboard has a year of context:
//   Avis Lease Info  → fleet_avis_lines per month of TRANSACTION DATE
//   Tracking         → fleet_tracking_lines (Cartrack) per month of invoice Date (amounts excl, VAT added)
//   Insurance        → fleet_insurance_lines for ONE period (the sheet is the current schedule)
// First Auto cannot be backfilled from this workbook (no month column) — import the monthly statements instead.
//
//   node scripts/backfill-ytd.mjs "<YTD Running Cost Fleet.xls>" [--insurance-period 2026-06] [--apply]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import XLSX from 'xlsx';
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply');
const insPeriod = args.includes('--insurance-period') ? args[args.indexOf('--insurance-period') + 1] : '2026-06';
if (!file) { console.error('usage: node scripts/backfill-ytd.mjs <fleet.xls> [--insurance-period YYYY-MM] [--apply]'); process.exit(1); }
const VAT = 15;
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };
const r2 = (n) => Math.round(n * 100) / 100;
const iso = (v) => { if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10); let m = String(v).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: vehicles } = await sb.from('fleet_vehicles').select('id,registration,branch_id'); const { data: branches } = await sb.from('fleet_branches').select('*');
const vByReg = new Map(vehicles.map((v) => [normReg(v.registration), v]));
const branchOf = (s) => { const k = normKey(s).toUpperCase(); return branches.find((b) => b.code === k || b.name.toUpperCase() === k || (b.aliases ?? []).some((a) => a.toUpperCase() === k)) ?? branches.find((b) => k && (b.aliases ?? []).some((a) => a.length > 3 && k.includes(a.toUpperCase()))) ?? null; };

const wb = XLSX.readFile(file); const R = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });

// ------------------------------------------------------------ Avis
const avisRows = R('Avis Lease Info').slice(1).filter((r) => r[2] && r[18]);
const avisByPeriod = new Map();
for (const r of avisRows) {
  const d = iso(r[18]); if (!d) continue; const p = d.slice(0, 7); const reg = normReg(r[2]); const v = vByReg.get(reg); const b = branchOf(r[12]);
  (avisByPeriod.get(p) ?? avisByPeriod.set(p, []).get(p)).push({
    period: p, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, driver_name: String(r[1]).trim(), reg, mva_number: String(r[3]), kilometers: r[4] === '' ? null : toNum(r[4]),
    rental_excl: toNum(r[6]), vat: toNum(r[7]), amount_due: toNum(r[8]), vat_claimable: toNum(r[9]), total: toNum(r[11]), cost_centre_name: String(r[12]).trim(), vehicle_type: String(r[14]).trim(), product: String(r[15]).trim(),
    transaction_type: String(r[16]).trim(), make_model: String(r[17]).trim(), transaction_date: d, document_no: String(r[19]).trim(), transaction_number: String(r[20]).trim(),
  });
}
// ------------------------------------------------------------ Tracking (Cartrack)
const trkRows = R('Tracking ').slice(1).filter((r) => r[0] && r[1] && r[3]);
const trkByPeriod = new Map();
for (const r of trkRows) {
  const d = iso(r[1]); if (!d) continue; const p = d.slice(0, 7); const reg = normReg(r[3]); const v = vByReg.get(reg); const b = branchOf(r[9]);
  const excl = toNum(r[7]); const vat = r2(excl * VAT / 100);
  (trkByPeriod.get(p) ?? trkByPeriod.set(p, []).get(p)).push({ period: p, provider: 'Cartrack', vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, invoice: String(r[0]).trim(), invoice_date: d, item_code: String(r[2]).trim(), reg, description: String(r[4]).trim(), quantity: toNum(r[5]) || null, amount_excl: excl, vat, total: r2(excl + vat), branch_name: String(r[9]).trim(), contract_id: String(r[10]).trim() });
}
// ------------------------------------------------------------ Insurance (one period)
const insRows = R('Insurance').slice(1).filter((r) => r[4] && toNum(r[15]));
const insLines = insRows.map((r) => { const reg = normReg(r[4]); const v = vByReg.get(reg); const b = branchOf(r[6]); const incl = toNum(r[15]); const excl = r2(incl / (1 + VAT / 100)); return { period: insPeriod, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, reg, year: toNum(r[1]) || null, make: String(r[2]).trim(), model: String(r[3]).trim(), branch_name: String(r[6]).trim(), tracking_unit: String(r[9]).trim() || null, retail_value: toNum(r[11]) || toNum(r[10]) || null, premium: excl, vat: r2(incl - excl), rate: toNum(r[16]) || null }; });

const sum = (a, k) => r2(a.reduce((s, x) => s + x[k], 0));
console.log('AVIS:'); for (const [p, ls] of [...avisByPeriod].sort()) console.log(`  ${p}: ${ls.length} lines, due R ${sum(ls, 'amount_due')}, unmatched vehicles ${ls.filter((l) => !l.vehicle_id).length}`);
console.log('TRACKING (Cartrack):'); for (const [p, ls] of [...trkByPeriod].sort()) console.log(`  ${p}: ${ls.length} lines, excl R ${sum(ls, 'amount_excl')}, unmatched ${ls.filter((l) => !l.vehicle_id).length}`);
console.log(`INSURANCE ${insPeriod}: ${insLines.length} vehicles, excl R ${sum(insLines, 'premium')}, unmatched ${insLines.filter((l) => !l.vehicle_id).length}`);
if (!APPLY) { console.log('\ndry run — add --apply to write'); process.exit(0); }

async function replaceImport(source, period, provider, rows, totalKey) {
  let q = sb.from('fleet_imports').delete().eq('source', source).eq('period', period); q = provider == null ? q.is('provider', null) : q.eq('provider', provider); await q;
  const { data, error } = await sb.from('fleet_imports').insert({ source, period, provider, file_name: file.split(/[\\/]/).pop(), row_count: rows.length, total_amount: sum(rows, totalKey), notes: 'backfilled from YTD workbook' }).select('id').single();
  if (error) throw error; return data.id;
}
async function chunked(table, rows) { for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from(table).insert(rows.slice(i, i + 500)); if (error) throw error; } }

for (const [p, ls] of avisByPeriod) { const id = await replaceImport('avis', p, null, ls, 'amount_due'); await chunked('fleet_avis_lines', ls.map((l) => ({ import_id: id, ...l }))); }
for (const [p, ls] of trkByPeriod) { const id = await replaceImport('tracking', p, 'Cartrack', ls, 'total'); await chunked('fleet_tracking_lines', ls.map((l) => ({ import_id: id, ...l }))); }
{ const id = await replaceImport('insurance', insPeriod, null, insLines, 'premium'); await chunked('fleet_insurance_lines', insLines.map((l) => ({ import_id: id, ...l }))); }
console.log('backfill written');
