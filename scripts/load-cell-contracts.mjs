// Loads the "Vodacom Master Data" workbook into fleet_cell_contracts (Master Data + Un-Claimed sheets, plus numbers that are on
// Vodacom's Subscriber Report but not on the master). Re-runnable: updates existing MSISDNs, inserts new ones, never deletes.
//   node scripts/load-cell-contracts.mjs "path\to\Vodacom Master Data Update.xlsx" [--apply]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js'; import ExcelJS from 'exceljs';
for (const l of readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply'); const FILE = process.argv.find((a) => /\.xlsx?$/i.test(a)); if (!FILE) throw new Error('give the workbook path');

const SITE = { 'Head Office': '000', 'Service Desk': 'CAP', 'Gauteng': 'GAU', 'Gauteng South': 'GAU', 'Gauteng North': 'GAU', 'Powerconnect': 'GAU', 'Secunda': 'SEC', 'Kathu': 'KAT', 'Kimberley': 'KAT', 'Vereeniging': 'VER', 'Bloemfontein': 'VER',
  'Cape Town': 'CPT', 'Durban': 'DBN', 'Rustenburg': 'RST', 'Richardsbay': 'RCH', 'Richards Bay': 'RCH', 'Middelburg': 'MDB', 'East London': 'ESL', 'Port Elizabeth': 'ESL', 'Capitec': 'CAP', 'Data Centre Services': 'DCS', 'DCS': 'DCS', 'Logistics': 'LOG' };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0'); const monOf = (s) => MON[s.toLowerCase().slice(0, 4)] ?? MON[s.toLowerCase().slice(0, 3)] ?? null;
function toDate(v) {
  if (v == null || v === '') return null; if (v instanceof Date) return isNaN(v) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const t = String(v).trim(); let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[0];
  if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)) && monOf(m[2])) return `${m[3]}-${pad(monOf(m[2]))}-${pad(m[1])}`;
  return null;
}
const txt = (v) => (v == null ? '' : v instanceof Date ? toDate(v) : typeof v === 'object' && v.richText ? v.richText.map((r) => r.text).join('') : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v)).trim();
const msisdnOf = (v) => { const s = txt(v).replace(/\D/g, ''); return s ? (s.length <= 9 ? s + '000' : s) : null; };   // 832939580000; some rows carry the 10-digit cell number instead
const cellOf = (msisdn, cell) => { const c = txt(cell).replace(/\D/g, ''); if (c) return c.length === 9 ? '0' + c : c; return msisdn ? '0' + msisdn.slice(0, -3) : null; };
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const cleanName = (s) => txt(s).replace(/[–—]/g, '-').replace(/\(.*?\)/g, ' ').replace(/[-.]\s*[A-Z]{2,4}\s*$/i, '').replace(/\s+(GP|GPN|GPS|HO|SD|PMO)$/i, '').replace(/\s+/g, ' ').trim();

const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
const sheet = (name) => { const ws = wb.getWorksheet(name); if (!ws) throw new Error('sheet missing: ' + name); const rows = []; ws.eachRow((r, i) => { rows.push([null, ...r.values.slice(1)]); }); return rows; };
const [{ data: staff }, { data: branches }, { data: existing }, { data: assets }] = await Promise.all([sb.from('fleet_staff').select('*').eq('kind', 'person'), sb.from('fleet_branches').select('id,code'), sb.from('fleet_cell_contracts').select('id,msisdn,holder_id,note'), sb.from('fleet_it_assets').select('id,holder_id,category,status').eq('category', 'Cellphone').neq('status', 'scrapped')]);
const bid = Object.fromEntries(branches.map((b) => [b.code, b.id]));
const idx = new Map(); const add = (k, s) => { if (!k) return; const l = idx.get(k) ?? []; if (!l.includes(s)) l.push(s); idx.set(k, l); };
for (const s of staff) { const p = s.full_name.split(/\s+/); add(nk(s.full_name), s); if (p.length > 1) { add(nk(p[0] + p[p.length - 1]), s); add(nk(p[p.length - 1] + p[0]), s); } }
const pick = (l) => l.length === 1 ? l[0] : (l.find((s) => s.status === 'active') ?? l[0]);
function match(name) {
  const n = ALIAS[cleanName(name)] ?? cleanName(name); if (!n || /unclaimed|training|printer|tablet|inter ?connect|testing|office|spare/i.test(n)) return null;
  const p = n.split(/\s+/); const tries = [nk(n)]; if (p.length > 1) tries.push(nk(p[0] + p[p.length - 1]), nk(p[p.length - 1] + p[0]), nk(p[0] + p[1]));
  for (const t of tries) { const l = idx.get(t); if (l) return pick(l); }
  const trunc = staff.filter((s) => nk(s.full_name).length >= 12 && nk(n).startsWith(nk(s.full_name))); if (trunc.length) return pick(trunc);
  if (p.length > 1) { const sur = nk(p[p.length - 1]); const first = nk(p[0]).slice(0, 3); const l = staff.filter((s) => nk(s.full_name).endsWith(sur) && nk(s.full_name).startsWith(first)); if (l.length) return pick(l); }
  if (p.length > 1) { const key = nk(p[0] + p[p.length - 1]); const l = staff.filter((s) => { const q = s.full_name.split(/\s+/); return q.length > 1 && lev(key, nk(q[0] + q[q.length - 1])) <= 2 && nk(q[0]).slice(0, 2) === nk(p[0]).slice(0, 2); }); if (l.length) return pick(l); }   // spelling variants
  return null;
}
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const ALIAS = { 'DICKIE VD NEST': 'Diederick Van Der Nest', 'MTHOBISI JAMA': 'Mpumelelo Jama', 'CHRISTAL VAN NIEWENHUIZEN': 'Christal Jansen Van Nieuwenhu', 'BOITSHWARELO MOKOKALE': 'Auganatia Mokakale', 'HEIN PIETERSEN': 'Hiniry Pietersen', 'RENAY SIEBRITZ - CPT OFFICE': 'Renay Siebritz', 'LODEWIKUS COETZEE - RTB': 'Wikus Coetzee' };

const rows = new Map();   // msisdn -> contract
const master = sheet('Master Data');
for (const r of master.slice(2)) {
  const msisdn = msisdnOf(r[2]) ?? (txt(r[3]).replace(/\D/g, '') ? txt(r[3]).replace(/\D/g, '').replace(/^0/, '') + '000' : null); if (!msisdn) continue;
  const branchName = txt(r[4]); const code = SITE[branchName] ?? null; const name = txt(r[5]); const holder = match(name);
  const c = { msisdn, cell_no: cellOf(msisdn, r[3]), holder_id: holder?.id ?? null, subscriber_name: name || null, branch_code: holder?.branch_code ?? code ?? null, branch_id: holder?.branch_id ?? (code ? bid[code] ?? null : null),
    category: holder?.category ?? null, job_title: txt(r[6]) || null, device_category: txt(r[7]) || null, package_range: txt(r[8]) || null, term_date: toDate(r[9]), upgrade_due: toDate(r[10]), last_upgrade: toDate(r[11]),
    contract_type: txt(r[12]) || null, device: txt(r[13]) || null, previous_device: txt(r[14]) || null, it_device_form: /^y/i.test(txt(r[15])) ? true : /^n/i.test(txt(r[15])) ? false : null,
    status: /cancel/i.test(txt(r[1])) ? 'to_cancel' : /unclaimed/i.test(name) ? 'unclaimed' : 'active', note: [txt(r[1]) && !/cancel/i.test(txt(r[1])) ? txt(r[1]) : '', txt(r[16]) ? 'Audit note: ' + txt(r[16]) : '', branchName && !code ? `Site on master: ${branchName}` : ''].filter(Boolean).join(' | ') || null, source: 'master' };
  if (rows.has(msisdn)) { const prev = rows.get(msisdn); prev.note = [prev.note, `Master lists this number twice (also "${name}")`].filter(Boolean).join(' | '); if (!prev.holder_id && holder) prev.holder_id = holder.id; continue; }
  rows.set(msisdn, c);
}
for (const r of sheet('Un-Claimed').slice(1)) {
  const cell = txt(r[1]).replace(/\D/g, ''); if (!cell) continue; const msisdn = cell.replace(/^0/, '') + '000'; const note = [`Previous user: ${txt(r[2])}`, txt(r[6])].filter(Boolean).join(' - ');
  const c = rows.get(msisdn); if (c) { c.status = c.status === 'to_cancel' ? c.status : 'unclaimed'; c.note = [c.note, note].filter(Boolean).join(' | '); }
  else rows.set(msisdn, { msisdn, cell_no: cell.length === 9 ? '0' + cell : cell, holder_id: null, subscriber_name: 'Unclaimed', branch_code: SITE[txt(r[3])] ?? null, branch_id: bid[SITE[txt(r[3])] ?? ''] ?? null, term_date: toDate(r[4]), contract_type: txt(r[5]) || null, status: 'unclaimed', note, source: 'master' });
}
let fromReport = 0;
for (const r of sheet('Subscriber Report').slice(1)) {
  const msisdn = msisdnOf(r[1]); if (!msisdn) continue; const c = rows.get(msisdn);
  const rep = { invoice_name: txt(r[3]) || null, activation_date: toDate(r[5]), sim_number: txt(r[14]).replace(/\D/g, '') || null, avg_spend: Number(txt(r[12]).replace(/[^\d.]/g, '')) || null };
  if (c) { Object.assign(c, { invoice_name: rep.invoice_name, activation_date: c.activation_date ?? rep.activation_date, sim_number: c.sim_number ?? rep.sim_number, avg_spend: rep.avg_spend }); continue; }
  const name = txt(r[2]); const holder = match(name); fromReport++;
  rows.set(msisdn, { msisdn, cell_no: cellOf(msisdn, null), holder_id: holder?.id ?? null, subscriber_name: name || null, ...rep, branch_code: holder?.branch_code ?? null, branch_id: holder?.branch_id ?? null, category: holder?.category ?? null, term_date: toDate(r[6]), last_upgrade: toDate(r[9]), contract_type: txt(r[11]) || null,
    status: txt(r[16]) === '4' ? 'cancelled' : holder ? 'active' : 'unassigned', note: `On Vodacom's subscriber report but not on the master${txt(r[16]) === '4' ? ' (Vodacom line status 4)' : ''}`, source: 'subscriber_report' });
}
// link the handset on the IT register where the holder has exactly one cellphone
for (const c of rows.values()) if (c.holder_id) { const a = assets.filter((x) => x.holder_id === c.holder_id); if (a.length === 1) c.asset_id = a[0].id; }
const all = [...rows.values()]; const byMs = new Map(existing.map((e) => [e.msisdn, e]));
const inserts = all.filter((c) => !byMs.has(c.msisdn)); const updates = all.filter((c) => byMs.has(c.msisdn));
const cnt = (f) => all.reduce((m, c) => (m[c[f] ?? '-'] = (m[c[f] ?? '-'] ?? 0) + 1, m), {});
console.log(`contracts ${all.length} (master ${all.length - fromReport}, subscriber-report only ${fromReport}); holder matched ${all.filter((c) => c.holder_id).length}; handset linked ${all.filter((c) => c.asset_id).length}`);
console.log('status', JSON.stringify(cnt('status')), '| branch', JSON.stringify(cnt('branch_code')), '| category', JSON.stringify(cnt('category')));
console.log('unmatched subscriber names:', all.filter((c) => !c.holder_id && c.status !== 'unclaimed').map((c) => `${c.subscriber_name} [${c.cell_no}]`).join('; '));
console.log(`to insert ${inserts.length}, to update ${updates.length}`);
if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
for (let i = 0; i < inserts.length; i += 200) { const { error } = await sb.from('fleet_cell_contracts').insert(inserts.slice(i, i + 200)); if (error) throw error; }
for (const c of updates) { const { error } = await sb.from('fleet_cell_contracts').update({ ...c, updated_at: new Date().toISOString() }).eq('msisdn', c.msisdn); if (error) throw error; }
console.log('applied');
