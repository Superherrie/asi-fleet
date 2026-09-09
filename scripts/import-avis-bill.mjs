// Imports an Avis billing detail sheet (the "BILL" / "Avis Lease Info" layout with RENTAL, VAT, VAT CLAIMABLE, TOTAL …)
//   node scripts/import-avis-bill.mjs "<workbook>" [--sheet BILL] [--period YYYY-MM] [--apply]
// Period defaults to the month of the MINV invoice dates (rentals are invoiced on the 1st for that month).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply');
const sheet = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : 'BILL'; const forced = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; }; const r2 = (n) => Math.round(n * 100) / 100;
const iso = (v) => typeof v === 'number' ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : (String(v).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null);

const wb = XLSX.read(readFileSync(file), { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
const h = rows.findIndex((r) => r.map(normKey).includes('reg no') && r.map(normKey).includes('rental')); const idx = new Map(rows[h].map((c, i) => [normKey(c), i]).filter(([k]) => k).reverse());
const c = (n) => idx.get(normKey(n)) ?? -1;
const col = { driver: c('driver name'), reg: c('reg no'), mva: c('mva number'), km: c('kilometers'), rental: c('rental'), vat: c('vat'), due: c('amount due'), vatc: c('vat claimable'), total: c('total'), cc: c('cost centre'), vtype: c('vehicle type'), product: c('product'), ttype: c('transaction type'), mm: c('make_model'), tdate: c('transaction date'), doc: c('document no'), tno: c('transaction number') };
const lines = rows.slice(h + 1).filter((r) => r[col.reg] && r[col.ttype]).map((r) => ({
  driver_name: String(r[col.driver]).trim(), reg: normReg(r[col.reg]), mva_number: String(r[col.mva]), kilometers: r[col.km] === '' ? null : toNum(r[col.km]),
  rental_excl: toNum(r[col.rental]), vat: toNum(r[col.vat]), amount_due: toNum(r[col.due]), vat_claimable: toNum(r[col.vatc]), total: toNum(r[col.total]),
  cost_centre_name: String(r[col.cc]).trim(), vehicle_type: String(r[col.vtype]).trim(), product: String(r[col.product]).trim(), transaction_type: String(r[col.ttype]).trim(),
  make_model: String(r[col.mm]).trim(), transaction_date: iso(r[col.tdate]), document_no: String(r[col.doc]).trim(), transaction_number: String(r[col.tno]).trim(),
}));
const minv = lines.filter((l) => l.transaction_type === 'MINV').map((l) => l.transaction_date?.slice(0, 7)).filter(Boolean);
const period = forced ?? minv.sort()[Math.floor(minv.length / 2)];
const sum = (k) => r2(lines.reduce((s, l) => s + l[k], 0));
console.log(`${basename(file)} [${sheet}] → ${period}: ${lines.length} lines · rental ${sum('rental_excl')} · VAT ${sum('vat')} · claimable ${sum('vat_claimable')} · expense (TOTAL) ${sum('total')} · due ${sum('amount_due')}`);
const { createClient } = await import('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: vehicles } = await sb.from('fleet_vehicles').select('id,registration,branch_id'); const { data: branches } = await sb.from('fleet_branches').select('*');
const vByReg = new Map(vehicles.map((v) => [normReg(v.registration), v]));
const branchOf = (s) => { const k = normKey(s).toUpperCase(); return branches.find((b) => b.code === k || b.name.toUpperCase() === k || (b.aliases ?? []).some((a) => a.toUpperCase() === k)) ?? null; };
const missing = [...new Set(lines.filter((l) => !vByReg.has(l.reg)).map((l) => l.reg))]; if (missing.length) console.log('  not on fleet master:', missing.join(', '));
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
await sb.from('fleet_imports').delete().eq('source', 'avis').eq('period', period).is('provider', null);
const { data: imp, error } = await sb.from('fleet_imports').insert({ source: 'avis', period, file_name: `${basename(file)} [${sheet}]`, row_count: lines.length, total_amount: sum('amount_due'), notes: 'Avis billing detail (RENTAL / VAT / VAT CLAIMABLE / TOTAL)' }).select('id').single(); if (error) throw error;
const payload = lines.map((l) => { const v = vByReg.get(l.reg); return { import_id: imp.id, period, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? branchOf(l.cost_centre_name)?.id ?? null, ...l }; });
for (let i = 0; i < payload.length; i += 500) { const { error: e } = await sb.from('fleet_avis_lines').insert(payload.slice(i, i + 500)); if (e) throw e; }
console.log(`imported ${payload.length} Avis lines for ${period}, amount due R ${sum('amount_due')}`);
