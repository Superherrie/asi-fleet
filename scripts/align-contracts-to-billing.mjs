// One-off (29 Oct 2026): make the app's contracts list agree with finance's "Master billing VODACOM" sheet for every number
// on the latest bill (holder, branch, category, voice/data), add billed numbers the list lacks, and load that bill as the
// first Vodacom import so the September journal can be generated from the app. Dry run unless --apply.
//   node scripts/align-contracts-to-billing.mjs "path\to\Master billing VODACOM Sep'26.xlsx" 2026-09 [--apply]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js'; import ExcelJS from 'exceljs';
for (const l of readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply'); const FILE = process.argv.find((a) => /\.xlsx?$/i.test(a)); const PERIOD = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)); if (!FILE || !PERIOD) throw new Error('give the workbook path and the period (YYYY-MM)');
const CAT = { OC: 'Ops Cabling', AD: 'Admin', SD: 'Sales', OA: 'Ops Admin', EX: 'Exec' };
const txt = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && v.richText ? v.richText.map((r) => r.text).join('') : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v)).trim();
const num = (v) => { const s = txt(v).replace(/ /g, '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''); const n = Number(s); return s && !isNaN(n) ? n : 0; };
const key = (v) => { const d = txt(v).replace(/\D/g, ''); return d.length === 12 && d.endsWith('000') ? d.slice(0, 9) : d.replace(/^0/, ''); };
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const dmy = (v) => { if (v instanceof Date) return v.toISOString().slice(0, 10); const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : (txt(v).match(/^\d{4}-\d{2}-\d{2}/) ? txt(v).slice(0, 10) : null); };

const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
const rowsOf = (name) => { const ws = wb.getWorksheet(name); const out = []; ws.eachRow((r) => out.push([null, ...r.values.slice(1)])); return out; };
const master = rowsOf('Master'); const h4 = master.findIndex((r) => txt(r[1]).toUpperCase() === 'CELL NO'); const hdr3 = h4 > 0 ? master[h4 - 1] : []; const sepCol = hdr3.findIndex((v) => /^SEP\d{2}/i.test(txt(v)));   // the month labels sit on the row above the CELL NO header
if (sepCol < 0 || h4 < 0) throw new Error('SEP column or CELL NO header not found on the Master sheet');
const billed = new Map();
for (const r of master.slice(h4 + 1)) { const k = key(r[1]); if (!k || !num(r[sepCol])) continue; billed.set(k, { cell: '0' + k, package: txt(r[2]), name: txt(r[3]), dept: txt(r[4]).toUpperCase(), gl: txt(r[5]), branch: txt(r[6]).toUpperCase(), emp: txt(r[10]), sep: num(r[sepCol]) }); }
if (process.argv.includes('--debug')) { console.log('hdr3 idx', master.indexOf(hdr3), 'sepCol', sepCol, 'h4', h4, 'first data row', master[h4 + 1]?.slice(0, 6).map(txt), 'sep value', JSON.stringify(master[h4 + 1]?.[sepCol]), 'num', num(master[h4 + 1]?.[sepCol]), 'key', key(master[h4 + 1]?.[1])); }
const billSheet = wb.worksheets.find((w) => /billing/i.test(w.name)); const bill = rowsOf(billSheet.name); const bhi = bill.findIndex((r) => r.some((v) => txt(v).toLowerCase() === 'msisdn no')); const bh = bill[bhi].map((v) => txt(v).toLowerCase()); const col = (n) => bh.indexOf(n);
const callsCols = bh.map((h, i) => (/^(calls - |bundles - |entertainment services|direct provisioning)/.test(h) ? i : -1)).filter((i) => i >= 0);
const otherCols = bh.map((h, i) => (/^(clip|blackberry|itemised billing|vodamanage|look 4 services|insurance|equipment|connection fee|admin fee|other)$/.test(h) || h === 'connection fee - discount' ? i : -1)).filter((i) => i >= 0);
const lines = [];
for (const r of bill.slice(bhi + 1)) { const ms = key(r[col('msisdn no')]); if (!ms) continue; const n = (i) => (i >= 0 ? num(r[i]) : 0);
  lines.push({ msisdn: ms, cell_no: '0' + ms, user_name: txt(r[col('user name')]) || null, tariff: txt(r[col('tariff')]) || null, invoice: txt(r[col('invoice no')]) || null, status: txt(r[col('status')]) || null, term_date: dmy(r[col('termination date')]),
    subscription: +(n(col('subscription')) + n(col('subscription - discount'))).toFixed(2), calls: +callsCols.reduce((s, i) => s + n(i), 0).toFixed(2), other: +otherCols.reduce((s, i) => s + n(i), 0).toFixed(2), amount_excl: n(col('total')), vat: n(col('vat')), total: n(col('grand total')) }); }

const [{ data: contracts }, { data: staff }, { data: branches }] = await Promise.all([sb.from('fleet_cell_contracts').select('*'), sb.from('fleet_staff').select('id,full_name,branch_code,branch_id,category,status').eq('kind', 'person'), sb.from('fleet_branches').select('id,code')]);
const bid = Object.fromEntries(branches.map((b) => [b.code, b.id])); const byMs = new Map(contracts.map((c) => [key(c.msisdn), c]));
const idx = new Map(); for (const s of staff) { const p = s.full_name.split(/\s+/); for (const k of [nk(s.full_name), p.length > 1 ? nk(p[0] + p[p.length - 1]) : '']) if (k) { const l = idx.get(k) ?? []; l.push(s); idx.set(k, l); } }
const pick = (l) => l.length === 1 ? l[0] : (l.find((s) => s.status === 'active') ?? l[0]);
function match(name) { const n = name.replace(/\(.*?\)/g, ' ').replace(/\s+(GAU|GPN|GPS|HO|SD|KAT|SEC|VER|CPT|DBN|RST|RCH|ESL|MDB|KLY|DCS|CAP|000|VEN|BLM|MDB)\b.*$/i, '').replace(/[-–].*$/, '').replace(/\s+/g, ' ').trim(); if (!n || /unclaimed|tablet|printer|office|data|spare|interconnect/i.test(n)) return null;
  const p = n.split(' '); for (const k of [nk(n), p.length > 1 ? nk(p[0] + p[p.length - 1]) : '', p.length > 2 ? nk(p[0] + p[1]) : '']) { const l = k && idx.get(k); if (l) return pick(l); } return null; }

const updates = [], inserts = [], diffs = []; let agree = 0;
for (const [ms, mrow] of billed) {
  const c = byMs.get(ms); const holder = match(mrow.name); const GLCAT = { '210000': 'Admin', '210100': 'Ops Cabling', '210200': 'Ops Admin', '210300': 'Sales', '210400': 'Exec' };
  const isData = mrow.gl === '404600' || mrow.dept === 'DATA' || /data/i.test(mrow.package);   // the GL column is what finance posted; the dept code is sometimes stale
  const want = { line_type: isData ? 'data' : 'voice', category: GLCAT[mrow.gl] ?? CAT[mrow.dept] ?? c?.category ?? holder?.category ?? null };
  if (mrow.branch && mrow.branch !== 'ZZZ') { want.branch_code = mrow.branch; want.branch_id = bid[mrow.branch] ?? null; if (c && ['unclaimed', 'unassigned'].includes(c.status)) want.status = 'active'; }   // finance charges it to a branch, so it is in use (a person or a pool number)
  else if (c) { if (!['to_cancel', 'cancelled', 'unclaimed'].includes(c.status)) want.status = 'unclaimed'; }
  if (holder && holder.id !== c?.holder_id) want.holder_id = holder.id;
  if (!c) { inserts.push({ msisdn: ms + '000', cell_no: mrow.cell, subscriber_name: mrow.name, holder_id: holder?.id ?? null, branch_code: want.branch_code ?? holder?.branch_code ?? null, branch_id: want.branch_id ?? holder?.branch_id ?? null, category: want.category, line_type: want.line_type, contract_type: mrow.package || null, status: mrow.branch === 'ZZZ' ? 'unclaimed' : 'active', source: 'billing_master', note: `Added from finance's billing master (${PERIOD}); not on the Vodacom master data sheet` }); continue; }
  const patch = {}; for (const [k, v] of Object.entries(want)) if ((c[k] ?? null) !== (v ?? null)) patch[k] = v;
  if (Object.keys(patch).length) { updates.push({ id: c.id, cell: mrow.cell, name: mrow.name, patch }); diffs.push(`${mrow.cell} ${mrow.name}: ${Object.entries(patch).map(([k, v]) => `${k} ${c[k] ?? '-'} -> ${v ?? '-'}`).join(', ')}`); } else agree++;
}
console.log(`billed numbers on the master ${billed.size}; bill lines ${lines.length}; already aligned ${agree}; to update ${updates.length}; to add ${inserts.length}`);
console.log('bill totals: excl', lines.reduce((s, l) => s + l.amount_excl, 0).toFixed(2), 'vat', lines.reduce((s, l) => s + l.vat, 0).toFixed(2), 'grand', lines.reduce((s, l) => s + l.total, 0).toFixed(2));
console.log(diffs.slice(0, 60).join('\n'));
if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
for (const u of updates) { const { error } = await sb.from('fleet_cell_contracts').update({ ...u.patch, updated_at: new Date().toISOString() }).eq('id', u.id); if (error) throw error; }
if (inserts.length) { const { error } = await sb.from('fleet_cell_contracts').insert(inserts); if (error) throw error; }
// the bill itself, as the first Vodacom import
const { data: fresh } = await sb.from('fleet_cell_contracts').select('id,msisdn'); const fm = new Map(fresh.map((c) => [key(c.msisdn), c.id]));
await sb.from('fleet_imports').delete().eq('source', 'vodacom').eq('period', PERIOD);
const { data: imp, error: ie } = await sb.from('fleet_imports').insert({ source: 'vodacom', period: PERIOD, provider: null, file_name: FILE.split(/[\\/]/).pop(), row_count: lines.length, total_amount: +lines.reduce((s, l) => s + l.total, 0).toFixed(2), notes: 'Loaded by script from the billing master workbook' }).select('id').single(); if (ie) throw ie;
for (let i = 0; i < lines.length; i += 200) { const { error } = await sb.from('fleet_cell_bill_lines').insert(lines.slice(i, i + 200).map((l) => ({ ...l, import_id: imp.id, period: PERIOD, contract_id: fm.get(l.msisdn) ?? null }))); if (error) throw error; }
console.log('applied: contracts aligned, bill lines loaded as import', imp.id);
