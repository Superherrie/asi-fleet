// One-off: loads the Jotform IT device declarations into fleet_it_assets. Dry run unless --apply.
//   node scripts/import-jotform-it.mjs path\to\jotform.json [--apply]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply'); const FILE = process.argv.find((a) => a.endsWith('.json')); if (!FILE) throw new Error('give the jotform json path');
const rows = JSON.parse(readFileSync(FILE, 'utf8'));
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

// Jotform branch / site -> fleet branch code (people get their payroll branch; this only places unmatched devices in a branch's stock)
const SITE = { 'Head Office': '000', 'Service Desk': '000', 'Gauteng': 'GAU', 'Gauteng South': 'GAU', 'Gauteng North': 'GAU', 'Powerconnect': 'GAU', 'Secunda': 'SEC', 'Kathu': 'KAT', 'Kimberley': 'KAT', 'Vereeniging': 'VER', 'Bloemfontein': 'VER',
  'Cape Town': 'CPT', 'Durban': 'DBN', 'Rustenburg': 'RST', 'Richardsbay': 'RCH', 'Middelburg': 'MDB', 'East London': 'ESL', 'Port Elizabeth': 'ESL' };
// submitter "names" that are really the branch's pool of devices
const STOCK_NAMES = /^(additional|additional device|additional devices|additional screen for dvr|additional tablet|camera pc|device currently not in use|devices currently not in use|durban|dvr|lms training|n\/a|greg manopole \/ stores|stores|spare cellphone|spare laptop|rental printer|office internet 3g)$/i;
// spelling fixes and preferred names: Jotform name -> payroll name
const ALIAS = { 'Joaquim <aia': 'Joaquim Maia', 'Cor van Niekekerk': 'Cor van Niekerk', 'Dean� van Zyl': 'Dean van Zyl', 'Ebenhaezer': 'Ebenhaezer Mccarthy', 'Nicole Mudau': 'Nico Mudau', 'Morne': 'Morne Swart',
  'Puleng Gilbert Kekana': 'Gilbert Kekana', 'Mamello Patience Matolo': 'Patience Matolo', 'Ntsime Isaac Mothibi': 'Isaac Mothibi', 'Dickie Van Der Nest': 'Diederick Van Der Nest', 'Gerhard Van Der Nest': 'Gerhardus Van Der Nest',
  'Boitshwarelo Mokakale': 'Auganatia Mokakale', 'LIZA': 'Liza Landman', 'Edwa Charles Mabula': 'Charles Mabula', 'Mthobisi Jama': 'Mpumelelo Jama' };
const CAT = (t) => { const s = String(t ?? '').toLowerCase();
  if (/cell|phone$/.test(s) && !/landline|pabx/.test(s)) return 'Cellphone'; if (/laptop/.test(s)) return 'Laptop'; if (/desktop/.test(s)) return 'Desktop'; if (/screen|tv/.test(s)) return 'Screen'; if (/tablet/.test(s)) return 'Tablet';
  if (/rout|dongle|wifi|extender/.test(s)) return 'Router / dongle'; if (/sim/.test(s)) return 'SIM card'; if (/print|plotter|laserjet|kyocera|canon|brother|hp t520/.test(s)) return 'Printer';
  if (/mouse|keyb|head|ear|speaker|charg|logi|adapter|jabra|parrot/.test(s)) return 'Accessory'; return 'Other'; };
const MON = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const toDate = (s) => { const t = String(s ?? '').trim(); let m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/); if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/); if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`; m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
const JUNK_SERIAL = /^(n\/?a|none|nil|unknown|no serial|-|\.|\?|x+)$/i;

const [{ data: staff }, { data: branches }] = await Promise.all([sb.from('fleet_staff').select('*'), sb.from('fleet_branches').select('id,code,name')]);
const people = staff.filter((s) => s.kind === 'person'); const stockFor = (code) => staff.find((s) => s.kind === 'stock' && s.branch_code === code);
const idx = new Map(); const add = (k, s) => { if (!k) return; const l = idx.get(k) ?? []; if (!l.includes(s)) l.push(s); idx.set(k, l); };
for (const s of people) { const parts = s.full_name.split(/\s+/); add(nk(s.full_name), s); if (parts.length > 1) { add(nk(parts[0] + parts[parts.length - 1]), s); add(nk(parts[parts.length - 1] + parts[0]), s); } }
const pick = (list) => list.length === 1 ? list[0] : (list.find((s) => s.status === 'active') ?? list[0]);
function match(name) {
  const n = ALIAS[name] ?? name.replace(/\s*\(.*\)\s*$/, ''); const parts = n.trim().split(/\s+/);
  const trunc = people.filter((s) => nk(s.full_name).length >= 12 && nk(n).startsWith(nk(s.full_name))); if (trunc.length) return pick(trunc);   // payroll names are cut at 30 characters
  const tries = [nk(n)]; if (parts.length > 1) { tries.push(nk(parts[0] + parts[parts.length - 1]), nk(parts[parts.length - 1] + parts[0])); if (parts.length > 2) tries.push(nk(parts[0] + parts[1] + parts[parts.length - 1])); }
  for (const t of tries) { const l = idx.get(t); if (l) return pick(l); }
  if (parts.length > 1) { const sur = nk(parts[parts.length - 1]); const first = nk(parts[0]); const l = people.filter((s) => nk(s.full_name).endsWith(sur) && nk(s.full_name).startsWith(first.slice(0, 3))); if (l.length) return pick(l); }
  return null;
}

// dedupe: one asset per serial (latest submission wins); junk serials are not deduped
const bySerial = new Map(); const out = []; const unmatched = new Map(); const stockUsed = {};
const sorted = [...rows].sort((a, b) => (toDate(a.submitted) ?? '').localeCompare(toDate(b.submitted) ?? ''));
for (const r of sorted) {
  const serial = String(r.serial ?? '').trim(); const key = serial && !JUNK_SERIAL.test(serial) ? serial.toLowerCase() : null;
  const name = String(r.name ?? '').trim(); const site = String(r.branch ?? '').trim(); const code = SITE[site] ?? null;
  let holder = null, note = null;
  if (STOCK_NAMES.test(name)) { holder = stockFor(code); note = `Jotform pool entry "${name}"`; }
  else { const s = match(name); if (s) holder = s; else { holder = stockFor(code); note = `Jotform submitter "${name}" (${site}) not found on the payroll master: placed in branch stock, reallocate`; unmatched.set(name, site); } }
  if (!holder) { holder = stockFor('000'); note = (note ?? '') + ` | site "${site}" has no branch: head-office stock`; }
  const a = { category: CAT(r.type), description: String(r.desc ?? '').trim() || String(r.type ?? '').trim(), serial_no: key ? serial : (serial || null), condition: r.condition ?? null, issued_on: toDate(r.issued), holder_id: holder.id,
    status: holder.kind === 'stock' ? 'in_stock' : 'allocated', site, source: 'jotform', source_ref: `Jotform: ${name}, ${site}, ${r.type}, submitted ${r.submitted}`, note, created_by_name: 'Jotform import' };
  if (key && bySerial.has(key)) { const prev = bySerial.get(key); prev.note = [prev.note, `Earlier Jotform submission by ${prev._name} (${prev._sub}) replaced by this one`].filter(Boolean).join(' | '); Object.assign(prev, a, { note: prev.note }); prev._name = name; prev._sub = r.submitted; continue; }
  a._name = name; a._sub = r.submitted; out.push(a); if (key) bySerial.set(key, a);
  if (holder.kind === 'stock') stockUsed[holder.full_name] = (stockUsed[holder.full_name] ?? 0) + 1;
}
console.log(`rows ${rows.length} -> ${out.length} assets (${rows.length - out.length} duplicate serials merged)`);
console.log('by category:', Object.entries(out.reduce((m, a) => (m[a.category] = (m[a.category] ?? 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('allocated to people:', out.filter((a) => a.status === 'allocated').length, '| in branch stock:', out.filter((a) => a.status === 'in_stock').length, JSON.stringify(stockUsed));
console.log('held by leavers:', out.filter((a) => a.status === 'allocated' && people.find((p) => p.id === a.holder_id)?.status === 'left').length);
console.log('unmatched submitters (' + unmatched.size + '):', [...unmatched].map(([n, s]) => `${n} [${s}]`).join('; '));
if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
const { count } = await sb.from('fleet_it_assets').select('id', { count: 'exact', head: true }).eq('source', 'jotform'); if (count) throw new Error(`${count} Jotform assets already loaded`);
for (let i = 0; i < out.length; i += 200) {
  const chunk = out.slice(i, i + 200).map(({ _name, _sub, ...a }) => a); const { data, error } = await sb.from('fleet_it_assets').insert(chunk).select('id,holder_id,note'); if (error) throw error;
  const { error: e2 } = await sb.from('fleet_it_moves').insert(data.map((d) => ({ asset_id: d.id, action: 'added', to_holder: d.holder_id, note: 'Loaded from the Jotform IT device declarations (Oct 2026)', by_name: 'Jotform import' }))); if (e2) throw e2;
}
console.log('applied', out.length);
